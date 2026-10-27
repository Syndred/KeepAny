package io.github.syndred.keepany;

import java.io.*;
import java.net.Proxy;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;

/** Explicit origins only. No WebView/system cookie jar, credential persistence or logging. */
final class ConnectionsHttp implements AutoCloseable {
    static final int AI_INPUT_LIMIT=16*1024*1024, AI_OUTPUT_LIMIT=8*1024*1024;
    private static final Set<String> AI_PROVIDERS=new HashSet<>(Arrays.asList("openai","anthropic","google","deepseek","qwen","doubao","moonshot","minimax","openrouter","ollama","compatible"));
    private static final Set<String> AI_HEADERS=new HashSet<>(Arrays.asList("accept","content-type","user-agent","authorization","x-api-key","x-goog-api-key","anthropic-version","anthropic-beta","openai-organization","openai-project","http-referer","x-title","x-openrouter-title"));
    static final class AiTimeout extends IOException { AiTimeout(){super("native-ai-timeout");} }
    static String aiFailureCode(Throwable error){return error instanceof AiTimeout||error instanceof java.net.SocketTimeoutException?"TIMEOUT":"native-ai-failed";}
    private static final class SecretBuffer extends ByteArrayOutputStream { void clear(){Arrays.fill(buf,(byte)0);reset();} }
    private static final class AiTransfer {
        final String id; final HttpUrl url; final Map<String,String> headers; final long deadline;
        final SecretBuffer input=new SecretBuffer(); byte[] received; Call call; ScheduledFuture<?> expiry; boolean sealed,closed;
        AiTransfer(String id,HttpUrl url,Map<String,String> headers,int timeout){this.id=id;this.url=url;this.headers=new HashMap<>(headers);deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeout);}
        void clear(){input.clear();if(received!=null)Arrays.fill(received,(byte)0);received=null;headers.clear();if(expiry!=null){expiry.cancel(false);expiry=null;}}
    }
    private AiTransfer ai;
    private String aiExpiredId;
    private final Map<String,Long> aiCancelled=new HashMap<>();
    private final ScheduledThreadPoolExecutor aiClock=new ScheduledThreadPoolExecutor(1,task->{Thread worker=new Thread(task,"KeepAny-AI-deadline");worker.setDaemon(true);return worker;});
    static final int BACKUP_LIMIT = 100 * 1024 * 1024 + 1024, CHUNK = 256 * 1024, JSON_LIMIT = 8 * 1024 * 1024;
    static final class Failure extends IOException { Failure() { super("native-connections-failed"); } }
    static final class LimitFailure extends IOException { LimitFailure() { super("native-connections-limit"); } }
    static String failureCode(Throwable error) { return error instanceof LimitFailure ? "native-connections-limit" : "native-connections-failed"; }
    interface ClientFactory { OkHttpClient create(CookieJar cookies); }
    static final class Result {
        final int status; final long size; final Map<String,String> headers; final byte[] body;
        Result(int status, long size, Map<String,String> headers, byte[] body) { this.status=status;this.size=size;this.headers=headers;this.body=body; }
    }
    private static final class Session implements CookieJar {
        final String origin; final Map<String,Cookie> cookies = new HashMap<>(); volatile boolean closed;
        Session(String origin) { this.origin=origin; }
        public synchronized void saveFromResponse(HttpUrl url, List<Cookie> values) {
            if (closed) return;
            for(Cookie cookie: values) {
                String key=cookie.name()+"|"+cookie.domain()+"|"+cookie.path();
                if(cookie.expiresAt()<=System.currentTimeMillis()) cookies.remove(key); else cookies.put(key,cookie);
            }
            if(cookies.size()>256)cookies.clear();
        }
        public synchronized List<Cookie> loadForRequest(HttpUrl url) {
            if(closed) return Collections.emptyList();
            cookies.values().removeIf(cookie -> cookie.expiresAt()<=System.currentTimeMillis());
            List<Cookie> result=new ArrayList<>();for(Cookie cookie:cookies.values()) if(cookie.matches(url)) result.add(cookie);return result;
        }
        synchronized void close() {closed=true;cookies.clear();}
    }
    private final File root;
    private final ClientFactory clients;
    private final Map<String,Session> sessions = new HashMap<>();
    private final Map<String,File> files = new HashMap<>();
    private final Map<String,Call> calls = new HashMap<>();
    private final Map<String,Session> owners = new HashMap<>();
    private final Set<String> sealed = new HashSet<>();
    private final Map<String,Long> cancelled = new HashMap<>();
    ConnectionsHttp(File root) { this(root, ConnectionsHttp::client); }
    ConnectionsHttp(File root, ClientFactory clients) { this.root=root;this.clients=clients;aiClock.setRemoveOnCancelPolicy(true); }
    static OkHttpClient client(CookieJar cookies) {
        return new OkHttpClient.Builder().cookieJar(cookies).cache(null).proxy(Proxy.NO_PROXY)
            .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(8,TimeUnit.SECONDS).callTimeout(30,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).writeTimeout(30,TimeUnit.SECONDS).build();
    }
    static HttpUrl target(String value) throws Failure {
        HttpUrl url=HttpUrl.parse(value);
        if(url==null||!url.isHttps()||!url.username().isEmpty()||!url.password().isEmpty()||url.fragment()!=null||value.length()>8192) throw new Failure();
        return url;
    }
    static String origin(HttpUrl url) { String base=url.newBuilder().encodedPath("/").query(null).fragment(null).build().toString();return base.substring(0,base.length()-1); }
    static HttpUrl aiTarget(String provider,String base,String model) throws Failure {
        HttpUrl url=base==null?null:HttpUrl.parse(base);
        if(!AI_PROVIDERS.contains(provider)||url==null||base.length()>2048||!url.username().isEmpty()||!url.password().isEmpty()||url.query()!=null||url.fragment()!=null||model==null||model.trim().isEmpty()||model.length()>200||
            !url.isHttps()&&!(url.scheme().equals("http")&&Arrays.asList("localhost","127.0.0.1","::1").contains(url.host())))throw new Failure();
        String value=url.toString().replaceAll("/+$","");
        if(provider.equals("anthropic")||provider.equals("minimax"))value+="/messages";
        else if(provider.equals("google")) {
            String path=model.contains("/")?model:"models/"+model;
            if(!path.matches("[A-Za-z0-9_./-]+")||Arrays.stream(path.split("/",-1)).anyMatch(part->part.isEmpty()||part.equals(".")||part.equals("..")))throw new Failure();
            value+="/"+path+":generateContent";
        } else {if(value.endsWith("/chat/completions"))value=value.substring(0,value.length()-"/chat/completions".length());value+="/chat/completions";}
        HttpUrl endpoint=HttpUrl.parse(value);if(endpoint==null||!origin(endpoint).equals(origin(url)))throw new Failure();return endpoint;
    }
    synchronized void aiOpen(String id,String provider,String base,String model,Map<String,String> headers,int timeout) throws IOException {
        aiId(id);if(ai!=null||calls.containsKey(id)||files.containsKey(id)||timeout<1||timeout>120000)throw new Failure();
        HttpUrl url=aiTarget(provider,base,model);int total=0;
        for(Map.Entry<String,String> header:headers.entrySet()) {
            String name=header.getKey(),value=header.getValue();total+=(name+value).getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
            if(!AI_HEADERS.contains(name)||value.length()>16384||value.matches("(?s).*[\\r\\n\\x00].*")||total>65536)throw new Failure();
        }
        if(!headers.getOrDefault("content-type","").toLowerCase(Locale.ROOT).matches("application/json(?:\\s*;.*)?"))throw new Failure();
        if(id.equals(aiExpiredId))aiExpiredId=null;
        AiTransfer entry=new AiTransfer(id,url,headers,timeout);ai=entry;
        entry.expiry=aiClock.schedule(()->expireAi(entry),timeout,TimeUnit.MILLISECONDS);
    }
    private synchronized AiTransfer aiLive(String id) throws IOException {
        if(id!=null&&id.equals(aiExpiredId))throw new AiTimeout();aiId(id);if(ai==null||!ai.id.equals(id)||ai.closed)throw new Failure();if(System.nanoTime()>=ai.deadline)throw new AiTimeout();return ai;
    }
    private synchronized void aiId(String id) throws Failure {checkedId(id);long now=System.currentTimeMillis();aiCancelled.values().removeIf(deadline->deadline<now);if(aiCancelled.containsKey(id))throw new Failure();}
    private void expireAi(AiTransfer entry) {
        Call pending;synchronized(this){if(ai!=entry)return;aiExpiredId=entry.id;aiCancelled.put(entry.id,System.currentTimeMillis()+120000);entry.closed=true;pending=entry.call;entry.clear();if(pending==null)ai=null;}
        if(pending!=null)pending.cancel();
    }
    synchronized void aiWrite(String id,byte[] bytes) throws IOException {
        AiTransfer transfer=aiLive(id);if(transfer.sealed||bytes.length==0||bytes.length>CHUNK||transfer.input.size()+bytes.length>AI_INPUT_LIMIT)throw new Failure();transfer.input.write(bytes);
    }
    Result aiRequest(String id) throws IOException {
        AiTransfer transfer;byte[] bytes;OkHttpClient client;Call call;
        synchronized(this) {
            transfer=aiLive(id);if(transfer.sealed||transfer.input.size()==0)throw new Failure();transfer.sealed=true;
            bytes=transfer.input.toByteArray();transfer.input.clear();
            Request.Builder request=new Request.Builder().url(transfer.url);for(Map.Entry<String,String> entry:transfer.headers.entrySet())request.header(entry.getKey(),entry.getValue());
            long remaining=Math.max(1,TimeUnit.NANOSECONDS.toMillis(transfer.deadline-System.nanoTime()));
            client=clients.create(CookieJar.NO_COOKIES).newBuilder().callTimeout(remaining,TimeUnit.MILLISECONDS).readTimeout(remaining,TimeUnit.MILLISECONDS).writeTimeout(remaining,TimeUnit.MILLISECONDS).build();
            call=client.newCall(request.post(RequestBody.create(bytes,MediaType.get("application/json"))).build());transfer.call=call;
        }
        SecretBuffer output=new SecretBuffer();boolean success=false;
        try(Response response=aiExecute(id,call)) {
            if(response.code()<200||response.code()>599||response.code()>=300&&response.code()<400||!response.request().url().equals(transfer.url))throw new Failure();
            ResponseBody body=response.body();if(body==null||body.contentLength()>AI_OUTPUT_LIMIT)throw new Failure();
            byte[] buffer=new byte[8192];try(InputStream input=body.byteStream()) {int count;while((count=input.read(buffer))!=-1){aiLive(id);if(output.size()+count>AI_OUTPUT_LIMIT)throw new Failure();output.write(buffer,0,count);}}finally{Arrays.fill(buffer,(byte)0);}
            synchronized(this){aiLive(id);transfer.received=output.toByteArray();success=true;return new Result(response.code(),transfer.received.length,responseHeaders(response),null);}
        } catch(IOException error) {if(System.nanoTime()>=transfer.deadline)throw new AiTimeout();throw error;}
        finally {Arrays.fill(bytes,(byte)0);output.clear();synchronized(this){transfer.call=null;transfer.headers.clear();if(!success||transfer.closed){transfer.clear();if(ai==transfer)ai=null;}}client.connectionPool().evictAll();}
    }
    private Response aiExecute(String id,Call call) throws IOException {aiLive(id);return call.execute();}
    synchronized byte[] aiRead(String id,long offset) throws IOException {
        AiTransfer transfer=aiLive(id);if(transfer.received==null||offset<0||offset>=transfer.received.length)throw new Failure();return Arrays.copyOfRange(transfer.received,(int)offset,(int)Math.min(transfer.received.length,offset+CHUNK));
    }
    void aiCancel(String id) {
        Call pending=null;synchronized(this){if(id==null)return;if(id.equals(aiExpiredId))aiExpiredId=null;aiCancelled.put(id,System.currentTimeMillis()+120000);if(ai!=null&&ai.id.equals(id)){ai.closed=true;pending=ai.call;ai.clear();if(pending==null)ai=null;}}
        if(pending!=null)pending.cancel();
    }
    static boolean syncRoute(String path,String method) {
        if(path.equals("/workspaces")) return method.equals("GET")||method.equals("POST");
        if(path.equals("/sync/devices")) return method.equals("GET");
        if(Arrays.asList("/sync/identity","/sync/preflight","/sync/push","/sync/pull").contains(path)) return method.equals("POST");
        if(path.matches("/workspaces/[0-9a-fA-F-]{36}/attachments/[0-9a-fA-F-]{36}")) return method.equals("GET")||method.equals("PUT");
        if(path.matches("/workspaces/[0-9a-fA-F-]{36}/key-envelopes(?:/[0-9a-fA-F-]{36}(?:/revoke)?)?"))
            return path.endsWith("/revoke")?method.equals("POST"):method.equals("GET")||method.equals("POST")&&path.endsWith("/key-envelopes");
        return false;
    }
    static boolean sessionRoute(String path,String method) {
        return path.equals("/api/auth/get-session")&&method.equals("GET") ||
            Arrays.asList("/api/auth/sign-in/email","/api/auth/sign-up/email","/api/auth/sign-out").contains(path)&&method.equals("POST") || syncRoute(path,method);
    }
    private void checkedId(String id) throws Failure { if(id==null||!id.matches("[0-9a-fA-F-]{36}")) throw new Failure(); }
    private synchronized void live(String id) throws Failure {
        checkedId(id);long now=System.currentTimeMillis();cancelled.values().removeIf(deadline->deadline<now);if(cancelled.containsKey(id))throw new Failure();
    }
    synchronized String openSession(String input) throws IOException {
        HttpUrl url=target(input);if(!input.equals(origin(url))||sessions.size()>=4)throw new Failure();
        for(Session session:sessions.values())if(session.origin.equals(input))throw new Failure();
        String id=UUID.randomUUID().toString();sessions.put(id,new Session(input));return id;
    }
    synchronized void closeSession(String id) {Session session=sessions.remove(id);if(session!=null){session.close();for(Map.Entry<String,Session> owner:owners.entrySet())if(owner.getValue()==session){Call call=calls.get(owner.getKey());if(call!=null)call.cancel();}}}
    private static Map<String,String> responseHeaders(Response response) {
        Map<String,String> result=new HashMap<>();for(String name:Arrays.asList("content-type","content-length")) {
            String value=response.header(name);if(value!=null&&value.length()<1024)result.put(name,value);
        }return result;
    }
    private static Request request(HttpUrl url,String method,Map<String,String> headers,byte[] bytes,File file,Session session) throws IOException {
        Request.Builder builder=new Request.Builder().url(url).header("Accept-Encoding","identity");
        Set<String> allowed=session==null?new HashSet<>(Arrays.asList("authorization","content-type")):new HashSet<>(Arrays.asList("accept","content-type","x-keepany-account-id","x-ciphertext-sha256"));
        for(Map.Entry<String,String> header:headers.entrySet()) {
            String name=header.getKey().toLowerCase(Locale.ROOT),value=header.getValue();
            if(!allowed.contains(name)||value.length()>16384||value.matches("(?s).*[\\r\\n\\x00].*"))throw new Failure();builder.header(name,value);
        }
        if(session!=null)builder.header("Origin",session.origin);
        RequestBody body=null;
        if(!method.equals("GET")) body=file!=null?RequestBody.create(file,MediaType.parse(headers.getOrDefault("content-type","application/octet-stream"))):RequestBody.create(bytes,MediaType.parse(headers.getOrDefault("content-type","application/json")));
        else if(bytes.length>0)throw new Failure();
        return builder.method(method,body).build();
    }
    private Result execute(String id,Request request,Session session,int limit,File output) throws IOException {
        live(id);OkHttpClient client=clients.create(session==null?CookieJar.NO_COOKIES:session);Call call=client.newCall(request);
        synchronized(this){live(id);if(calls.size()>=4||calls.containsKey(id)||session!=null&&session.closed)throw new Failure();calls.put(id,call);if(session!=null)owners.put(id,session);}
        try(Response response=call.execute()) {
            if(response.code()<200||response.code()>=600||response.code()>=300&&response.code()<400||!response.request().url().equals(request.url()))throw new Failure();
            ResponseBody body=response.body();if(body==null)throw new Failure();if(body.contentLength()>limit)throw output==null?new Failure():new LimitFailure();
            long total=0;ByteArrayOutputStream bytes=output==null?new ByteArrayOutputStream():null;
            try(InputStream input=body.byteStream();OutputStream sink=output==null?bytes:new FileOutputStream(output)) {
                byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){live(id);total+=count;if(total>limit)throw output==null?new Failure():new LimitFailure();sink.write(buffer,0,count);}
            }
            live(id);return new Result(response.code(),total,responseHeaders(response),bytes==null?null:bytes.toByteArray());
        } finally { synchronized(this){calls.remove(id);owners.remove(id);}client.connectionPool().evictAll(); }
    }
    Result sessionRequest(String id,String sessionId,String input,String method,Map<String,String> headers,byte[] bytes) throws IOException {
        Session session;synchronized(this){session=sessions.get(sessionId);}if(session==null||session.closed)throw new Failure();
        HttpUrl url=target(input);int limit=url.encodedPath().contains("/attachments/")?4*1024*1024:JSON_LIMIT;
        if(!origin(url).equals(session.origin)||url.query()!=null||!sessionRoute(url.encodedPath(),method)||bytes.length>limit)throw new Failure();
        Result result=execute(id,request(url,method,headers,bytes,null,session),session,limit,null);if(session.closed)throw new Failure();return result;
    }
    private synchronized File transfer(String id) throws IOException {
        live(id);File file=files.get(id);if(file!=null)return file;
        if(files.size()>=2||!root.isDirectory()&&!root.mkdirs())throw new Failure();
        file=new File(root,"transfer-"+id+".bin");if(!file.createNewFile())throw new Failure();files.put(id,file);return file;
    }
    synchronized void backupWrite(String id,byte[] bytes) throws IOException {
        if(bytes.length==0||bytes.length>CHUNK||sealed.contains(id))throw new Failure();File file=transfer(id);if(file.length()+bytes.length>BACKUP_LIMIT)throw new LimitFailure();
        try(FileOutputStream out=new FileOutputStream(file,true)){out.write(bytes);}
    }
    Result backupRequest(String id,String input,String method,Map<String,String> headers) throws IOException {
        HttpUrl url=target(input);String host=url.host();
        if(!Arrays.asList("GET","PUT").contains(method)||!host.contains(".")||host.matches("[0-9.]+")||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal"))throw new Failure();
        File file=transfer(id);
        synchronized(this){if(sealed.contains(id))throw new Failure();sealed.add(id);}
        if(method.equals("PUT")) {
            if(file.length()==0)throw new Failure();if(file.length()>BACKUP_LIMIT)throw new LimitFailure();
            return execute(id,request(url,method,headers,new byte[0],file,null),null,8192,null);
        }
        return execute(id,request(url,method,headers,new byte[0],null,null),null,BACKUP_LIMIT,file);
    }
    synchronized byte[] backupRead(String id,long offset) throws IOException {
        live(id);File file=files.get(id);if(file==null||offset<0||offset>=file.length()||calls.containsKey(id))throw new Failure();
        try(RandomAccessFile input=new RandomAccessFile(file,"r")){input.seek(offset);byte[] result=new byte[(int)Math.min(CHUNK,file.length()-offset)];input.readFully(result);return result;}
    }
    synchronized void cancel(String id) {
        if(id==null)return;cancelled.put(id,System.currentTimeMillis()+120000);sealed.remove(id);Call call=calls.get(id);if(call!=null)call.cancel();File file=files.remove(id);if(file!=null)file.delete();
    }
    public synchronized void close() {if(ai!=null)aiCancel(ai.id);aiClock.shutdownNow();for(Session session:sessions.values())session.close();sessions.clear();for(String id:new ArrayList<>(files.keySet()))cancel(id);for(Call call:calls.values())call.cancel();}
}
