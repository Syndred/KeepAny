package io.github.syndred.keepany;

import io.netty.bootstrap.ServerBootstrap;
import io.netty.buffer.*;
import io.netty.channel.*;
import io.netty.channel.group.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.*;
import io.netty.handler.ssl.*;
import io.netty.util.ReferenceCountUtil;
import io.netty.util.concurrent.GlobalEventExecutor;
import java.io.ByteArrayOutputStream;
import java.net.*;
import java.nio.charset.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;

/** Native TLS/HTTP IO only. The trusted JS owner handles MCP, pairing, grants and approval. */
final class McpHttpsServer implements AutoCloseable {
    static final int REQUEST_LIMIT=1_000_000, RESPONSE_LIMIT=8*1024*1024, CHUNK_LIMIT=256*1024, HEADER_LIMIT=16*1024, HEADER_COUNT=64, DEADLINE_MS=30000, FLIGHTS=4, PREPARE_MS=120000;
    static final class Failure extends Exception {Failure(){super("mcp-transport-failed");}Failure(String code){super(code);}}
    interface Events {void request(Request request);void cancelled(String instanceId,String requestId);void stopped(String instanceId);}
    static final class Request {
        final String instanceId,requestId,method,path,host,body;final Map<String,String> headers;
        Request(String instance,String id,String method,String path,String host,Map<String,String> headers,String body){this.instanceId=instance;requestId=id;this.method=method;this.path=path;this.host=host;this.headers=Collections.unmodifiableMap(new LinkedHashMap<>(headers));this.body=body;}
    }
    private static final Set<String> SINGLE=new HashSet<>(Arrays.asList("host","authorization","content-length","content-type","origin","transfer-encoding"));
    private static final Set<String> RESPONSE_HEADERS=new HashSet<>(Arrays.asList("content-type","cache-control","x-content-type-options","mcp-session-id","mcp-protocol-version","allow","www-authenticate","retry-after","vary","access-control-allow-origin","access-control-expose-headers"));
    private static final byte[] ERROR="{\"error\":\"mcp-transport-failed\"}".getBytes(StandardCharsets.UTF_8);
    final String instanceId=UUID.randomUUID().toString();
    private final Events events;
    private final Object lock=new Object();
    private final Map<String,Pending> pending=new LinkedHashMap<>();
    private final ChannelGroup connections=new DefaultChannelGroup(GlobalEventExecutor.INSTANCE);
    private EventLoopGroup boss,workers;
    private McpTlsIdentity identity;
    private SslContext tls;
    private Channel listener;
    private boolean stopped;
    private int port;
    private long preparedUntilNanos,preparedUntilMillis;
    private final String address;
    private McpHttpsServer(String address,Events events){this.address=address;this.events=events;}
    private static final class Buffer extends ByteArrayOutputStream {
        ByteBuf detach(){ByteBuf value=Unpooled.wrappedBuffer(buf,0,count);buf=new byte[0];count=0;return value;}
        void discard(){Arrays.fill(buf,(byte)0);buf=new byte[0];count=0;}
    }
    private static final class Pending {
        final String id=UUID.randomUUID().toString();final Channel channel;
        boolean head,dispatched,started,ending;
        String path,host;Map<String,String> headers,responseHeaders;int status;
        final Buffer response=new Buffer();ScheduledFuture<?> deadline;CompletableFuture<Void> completion;
        Pending(Channel channel){this.channel=channel;}
    }
    static InetAddress checkedAddress(String text) throws Exception {
        if(text==null||!text.matches("(?:0|[1-9][0-9]{0,2})(?:\\.(?:0|[1-9][0-9]{0,2})){3}"))throw new Failure();
        String[] parts=text.split("\\.");byte[] bytes=new byte[4];int[] values=new int[4];for(int i=0;i<4;i++){values[i]=Integer.parseInt(parts[i]);if(values[i]>255)throw new Failure();bytes[i]=(byte)values[i];}
        if(!text.equals("127.0.0.1")&&values[0]!=10&&!(values[0]==192&&values[1]==168)&&!(values[0]==172&&values[1]>=16&&values[1]<=31))throw new Failure();
        InetAddress address=InetAddress.getByAddress(bytes);Enumeration<NetworkInterface> interfaces=NetworkInterface.getNetworkInterfaces();
        while(interfaces!=null&&interfaces.hasMoreElements()){NetworkInterface network=interfaces.nextElement();if(!network.isUp())continue;Enumeration<InetAddress> addresses=network.getInetAddresses();while(addresses.hasMoreElements())if(address.equals(addresses.nextElement()))return address;}
        throw new Failure();
    }
    static McpHttpsServer prepare(String address,Events events,BooleanSupplier permitted) throws Exception {
        McpHttpsServer server=new McpHttpsServer(address,events);
        try {
            InetAddress local=checkedAddress(address);if(!permitted.getAsBoolean())throw new Failure();server.identity=McpTlsIdentity.create(address);server.tls=server.identity.context();
            // Reserve no listener while the system file picker/share sheet backgrounds the app.
            // A competing bind is detected at activate; never silently replace this exported URL.
            try(ServerSocket probe=new ServerSocket()){probe.setReuseAddress(false);probe.bind(new InetSocketAddress(local,0),1);server.port=probe.getLocalPort();}
            server.preparedUntilNanos=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(PREPARE_MS);server.preparedUntilMillis=System.currentTimeMillis()+PREPARE_MS;
            if(!permitted.getAsBoolean())throw new Failure();return server;
        } catch(Exception failure){server.close();throw new Failure();}
    }
    static McpHttpsServer start(String address,Events events,BooleanSupplier permitted) throws Exception {
        McpHttpsServer server=prepare(address,events,permitted);server.activate(permitted);return server;
    }
    boolean isPrepared(){synchronized(lock){return !stopped&&identity!=null&&listener==null;}}
    boolean isActive(){synchronized(lock){return !stopped&&listener!=null;}}
    long preparationRemainingNanos(){return Math.max(0,Math.min(preparedUntilNanos-System.nanoTime(),TimeUnit.MILLISECONDS.toNanos(preparedUntilMillis-System.currentTimeMillis())));}
    void activate(BooleanSupplier permitted) throws Exception {
        synchronized(lock){if(stopped||identity==null||listener!=null)throw new Failure("mcp-transport-stale");}
        try {
            if(preparationRemainingNanos()==0||!permitted.getAsBoolean())throw new Failure();
            InetAddress local=checkedAddress(address);boss=new NioEventLoopGroup(1);workers=new NioEventLoopGroup(1);
            ServerBootstrap bootstrap=new ServerBootstrap().group(boss,workers).channel(NioServerSocketChannel.class)
                .option(ChannelOption.SO_REUSEADDR,false).childOption(ChannelOption.TCP_NODELAY,true).childHandler(new ChannelInitializer<SocketChannel>(){
                    protected void initChannel(SocketChannel channel){install(channel);}
                });
            if(!permitted.getAsBoolean())throw new Failure();listener=bootstrap.bind(new InetSocketAddress(local,port)).sync().channel();
            if(preparationRemainingNanos()==0||!permitted.getAsBoolean())throw new Failure();
        } catch(Exception failure){close();throw new Failure();}
    }
    String endpoint() throws Failure {synchronized(lock){if(stopped||port<=0)throw new Failure();return "https://"+address+":"+port+"/mcp";}}
    String certificatePem() throws Failure {synchronized(lock){if(stopped||identity==null)throw new Failure();return identity.certificatePem;}}
    String spkiSha256() throws Failure {synchronized(lock){if(stopped||identity==null)throw new Failure();return identity.spkiSha256;}}
    int pendingCount(){synchronized(lock){return pending.size();}}
    private void install(SocketChannel channel){
        Pending row=new Pending(channel);
        synchronized(lock){if(stopped||connections.size()>=FLIGHTS||pending.size()>=FLIGHTS){channel.close();return;}connections.add(channel);pending.put(row.id,row);}
        row.deadline=channel.eventLoop().schedule(()->abort(row,408,true),DEADLINE_MS,TimeUnit.MILLISECONDS);
        channel.pipeline().addLast("lifecycle",new ChannelInboundHandlerAdapter(){
            public void channelInactive(ChannelHandlerContext context){abort(row,500,false);context.fireChannelInactive();}
            public void exceptionCaught(ChannelHandlerContext context,Throwable failure){abort(row,400,false);}
        });
        SslHandler ssl=tls.newHandler(channel.alloc());ssl.setHandshakeTimeoutMillis(10000);channel.pipeline().addLast("tls",ssl);
        channel.pipeline().addLast("response-encoder",new HttpResponseEncoder());
        HttpDecoderConfig config=new HttpDecoderConfig().setMaxInitialLineLength(4096).setMaxHeaderSize(HEADER_LIMIT).setMaxChunkSize(8192).setValidateHeaders(true).setAllowDuplicateContentLengths(false).setStrictLineParsing(true).setUseRfc9112TransferEncoding(true);
        channel.pipeline().addLast("http-parser",new HttpRequestDecoder(config));
        channel.pipeline().addLast("headers",new ChannelInboundHandlerAdapter(){
            public void channelRead(ChannelHandlerContext context,Object message){
                if(message instanceof HttpRequest){
                    HttpRequest request=(HttpRequest)message;
                    try {
                        if(!request.decoderResult().isSuccess()||row.head)throw new Failure();row.head=true;
                        if(!request.method().equals(HttpMethod.POST)){ReferenceCountUtil.release(message);abort(row,405,true);return;}
                        if(!request.protocolVersion().equals(HttpVersion.HTTP_1_1)||!request.uri().equals("/mcp")&&!request.uri().equals("/pair"))throw new Failure();
                        LinkedHashMap<String,String> headers=new LinkedHashMap<>();Set<String> seen=new HashSet<>();int count=0,size=0;
                        for(Map.Entry<String,String> entry:request.headers()){
                            String key=entry.getKey().toLowerCase(Locale.ROOT),value=entry.getValue();size+=(key+value).getBytes(StandardCharsets.UTF_8).length+4;
                            if(++count>HEADER_COUNT||size>HEADER_LIMIT||!key.matches("[a-z0-9!#$%&'*+.^_`|~-]+")||value.matches("(?s).*[\\r\\n\\x00].*")||SINGLE.contains(key)&&!seen.add(key))throw new Failure();
                            headers.put(key,headers.containsKey(key)?headers.get(key)+","+value:value);
                        }
                        String host=headers.get("host");if(host==null||host.isEmpty()||host.length()>260||host.contains(",")||headers.containsKey("expect")||headers.containsKey("content-length")&&headers.containsKey("transfer-encoding"))throw new Failure();
                        if(headers.containsKey("transfer-encoding")&&!headers.get("transfer-encoding").equalsIgnoreCase("chunked"))throw new Failure();
                        if(HttpUtil.getContentLength(request,0)>REQUEST_LIMIT){ReferenceCountUtil.release(message);abort(row,413,true);return;}
                        row.path=request.uri();row.host=host;row.headers=headers;
                    }catch(Exception invalid){ReferenceCountUtil.release(message);abort(row,400,true);return;}
                }
                if(!live(row)){ReferenceCountUtil.release(message);return;}context.fireChannelRead(message);
            }
            public void exceptionCaught(ChannelHandlerContext context,Throwable failure){abort(row,400,true);}
        });
        channel.pipeline().addLast("body-budget",new HttpObjectAggregator(REQUEST_LIMIT){
            protected void handleOversizedMessage(ChannelHandlerContext context,HttpMessage message){abort(row,413,true);}
        });
        channel.pipeline().addLast("request",new SimpleChannelInboundHandler<FullHttpRequest>(){
            protected void channelRead0(ChannelHandlerContext context,FullHttpRequest request){
                try {
                    if(!request.decoderResult().isSuccess()||!request.trailingHeaders().isEmpty()||request.content().readableBytes()>REQUEST_LIMIT)throw new Failure();
                    String body=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(request.content().nioBuffer()).toString();
                    synchronized(lock){if(!live(row)||row.dispatched)throw new Failure();row.dispatched=true;}
                    events.request(new Request(instanceId,row.id,"POST",row.path,row.host,row.headers,body));
                }catch(Exception failure){abort(row,400,true);}
            }
            public void exceptionCaught(ChannelHandlerContext context,Throwable failure){abort(row,400,true);}
        });
    }
    private boolean live(Pending row){synchronized(lock){return !stopped&&pending.get(row.id)==row;}}
    private Pending lookup(String requestId) throws Failure {if(requestId==null||!requestId.matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))throw new Failure("mcp-transport-stale");Pending row=pending.get(requestId);if(stopped||row==null||!row.dispatched)throw new Failure("mcp-transport-stale");return row;}
    private Pending row(String requestId) throws Failure {Pending row=lookup(requestId);if(row.ending)throw new Failure("mcp-transport-stale");return row;}
    private static Map<String,String> checkedHeaders(Map<String,String> supplied) throws Failure {
        if(supplied==null||supplied.size()>HEADER_COUNT)throw new Failure();Map<String,String> result=new LinkedHashMap<>();int total=0;
        for(Map.Entry<String,String> entry:supplied.entrySet()){
            String key=entry.getKey(),value=entry.getValue();if(key==null||value==null||!RESPONSE_HEADERS.contains(key)||!key.equals(key.toLowerCase(Locale.ROOT)))throw new Failure();for(int i=0;i<value.length();i++){char ch=value.charAt(i);if(ch<32&&ch!='\t'||ch==127||ch>255)throw new Failure();}total+=(key+value).getBytes(StandardCharsets.UTF_8).length+4;if(total>HEADER_LIMIT)throw new Failure();result.put(key,value);
        }return result;
    }
    void responseStart(String requestId,int status,Map<String,String> headers) throws Failure {
        Pending request;synchronized(lock){request=row(requestId);}
        try {Map<String,String> checked=checkedHeaders(headers);if(status<200||status>599||status>=300&&status<400)throw new Failure();
            synchronized(lock){request=row(requestId);if(request.started)throw new Failure();request.started=true;request.status=status;request.responseHeaders=checked;}
        }catch(Failure failure){abort(request,500,false);throw failure;}
    }
    void responseWrite(String requestId,byte[] chunk) throws Failure {
        Pending request;synchronized(lock){request=row(requestId);if(!request.started)throw new Failure();if(chunk==null||chunk.length>CHUNK_LIMIT||request.response.size()+chunk.length>RESPONSE_LIMIT){abort(request,500,false);throw new Failure();}request.response.write(chunk,0,chunk.length);}
    }
    CompletableFuture<Void> responseEnd(String requestId) throws Failure {
        final Pending request;final FullHttpResponse response;
        synchronized(lock){request=row(requestId);if(!request.started||((request.status==204||request.status==205)&&request.response.size()!=0))throw new Failure();request.ending=true;request.completion=new CompletableFuture<>();response=new DefaultFullHttpResponse(HttpVersion.HTTP_1_1,HttpResponseStatus.valueOf(request.status),request.response.detach());for(Map.Entry<String,String> header:request.responseHeaders.entrySet())response.headers().set(header.getKey(),header.getValue());response.headers().set(HttpHeaderNames.CONTENT_LENGTH,response.content().readableBytes()).set(HttpHeaderNames.CONNECTION,"close");}
        try { request.channel.eventLoop().execute(()->{
            if(!live(request)||!request.channel.isActive()){ReferenceCountUtil.release(response);abort(request,500,false);return;}
            request.channel.writeAndFlush(response).addListener(future->{
                if(!future.isSuccess()){abort(request,500,false);return;}
                synchronized(lock){if(pending.remove(request.id,request)){if(request.deadline!=null)request.deadline.cancel(false);request.completion.complete(null);}}
                request.channel.close();
            });
        }); } catch(RuntimeException stoppedLoop){ReferenceCountUtil.release(response);abort(request,500,false);}return request.completion;
    }
    void cancel(String requestId) throws Failure {Pending request;synchronized(lock){request=lookup(requestId);}abort(request,500,false);}
    private void abort(Pending row,int status,boolean reply){
        synchronized(lock){if(!pending.remove(row.id,row))return;if(row.deadline!=null)row.deadline.cancel(false);row.response.discard();if(row.completion!=null)row.completion.completeExceptionally(new Failure());}
        try{events.cancelled(instanceId,row.id);}catch(Exception ignored){/* Native IO cannot depend on JS event delivery. */}
        if(reply&&row.channel.isActive()&&row.channel.pipeline().get("response-encoder")!=null){FullHttpResponse failure=new DefaultFullHttpResponse(HttpVersion.HTTP_1_1,HttpResponseStatus.valueOf(status),Unpooled.wrappedBuffer(ERROR));failure.headers().set(HttpHeaderNames.CONTENT_TYPE,"application/json").set(HttpHeaderNames.CACHE_CONTROL,"no-store").set("x-content-type-options","nosniff").set(HttpHeaderNames.CONTENT_LENGTH,ERROR.length).set(HttpHeaderNames.CONNECTION,"close");if(status==405)failure.headers().set(HttpHeaderNames.ALLOW,"POST");row.channel.writeAndFlush(failure).addListener(ChannelFutureListener.CLOSE);}else row.channel.close();
    }
    public void close(){
        List<Pending> rows;synchronized(lock){if(stopped)return;stopped=true;rows=new ArrayList<>(pending.values());}
        for(Pending row:rows)abort(row,500,false);if(listener!=null)listener.close().awaitUninterruptibly();connections.close().awaitUninterruptibly();
        if(boss!=null)boss.shutdownGracefully(0,1,TimeUnit.SECONDS).awaitUninterruptibly();if(workers!=null)workers.shutdownGracefully(0,1,TimeUnit.SECONDS).awaitUninterruptibly();
        synchronized(lock){listener=null;tls=null;if(identity!=null)identity.close();identity=null;}
        try{events.stopped(instanceId);}catch(Exception ignored){/* A failed listener must not reopen the native port. */}
    }
}
