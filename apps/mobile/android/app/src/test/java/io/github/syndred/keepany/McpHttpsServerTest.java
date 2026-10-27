package io.github.syndred.keepany;

import static org.junit.Assert.*;
import org.junit.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.*;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.*;

/** Real loopback TLS, production parser and production deadlines. All payloads synthetic. */
public class McpHttpsServerTest {
    private McpHttpsServer server;
    private final BlockingQueue<McpHttpsServer.Request> requests=new LinkedBlockingQueue<>();
    private final BlockingQueue<String> cancelled=new LinkedBlockingQueue<>(),stopped=new LinkedBlockingQueue<>();
    private final List<Socket> clients=new ArrayList<>();
    private final McpHttpsServer.Events events=new McpHttpsServer.Events(){
        public void request(McpHttpsServer.Request row){requests.add(row);}
        public void cancelled(String instance,String request){cancelled.add(request);}
        public void stopped(String instance){stopped.add(instance);}
    };
    @Before public void start() throws Exception {server=McpHttpsServer.start("127.0.0.1",events,()->true);}
    @After public void cleanup(){for(Socket socket:clients)try{socket.close();}catch(Exception ignored){}if(server!=null)server.close();}
    private int port() throws Exception{return new URI(server.endpoint()).getPort();}
    private X509Certificate certificate() throws Exception{return (X509Certificate)CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(server.certificatePem().getBytes(StandardCharsets.US_ASCII)));}
    private SSLSocketFactory trusted() throws Exception {
        KeyStore anchors=KeyStore.getInstance(KeyStore.getDefaultType());anchors.load(null);anchors.setCertificateEntry("explicit-start",certificate());
        TrustManagerFactory managers=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());managers.init(anchors);
        SSLContext context=SSLContext.getInstance("TLS");context.init(null,managers.getTrustManagers(),null);return context.getSocketFactory();
    }
    private SSLSocket connect(SSLSocketFactory factory,String hostname) throws Exception {
        Socket tcp=new Socket(Proxy.NO_PROXY);tcp.connect(new InetSocketAddress("127.0.0.1",port()),2000);clients.add(tcp);SSLSocket socket=(SSLSocket)factory.createSocket(tcp,hostname,port(),true);clients.add(socket);
        socket.setSoTimeout(4000);SSLParameters parameters=socket.getSSLParameters();parameters.setEndpointIdentificationAlgorithm("HTTPS");socket.setSSLParameters(parameters);socket.startHandshake();return socket;
    }
    private SSLSocket connect() throws Exception{return connect(trusted(),"127.0.0.1");}
    private void write(Socket socket,String raw) throws Exception {socket.getOutputStream().write(raw.getBytes(StandardCharsets.UTF_8));socket.getOutputStream().flush();}
    private SSLSocket request(byte[] body,String extra) throws Exception {
        SSLSocket socket=connect();write(socket,"POST /mcp HTTP/1.1\r\nHost: actual.example:443\r\nContent-Length: "+body.length+"\r\n"+extra+"\r\n");socket.getOutputStream().write(body);socket.getOutputStream().flush();return socket;
    }
    private McpHttpsServer.Request take() throws Exception {McpHttpsServer.Request row=requests.poll(4,TimeUnit.SECONDS);assertNotNull("actual native request event",row);return row;}
    private String read(Socket socket) throws Exception {ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] block=new byte[8192];for(int count;(count=socket.getInputStream().read(block))!=-1;)bytes.write(block,0,count);return bytes.toString("UTF-8");}
    private void reply(McpHttpsServer.Request row,String body) throws Exception {server.responseStart(row.requestId,200,Collections.singletonMap("content-type","application/json"));server.responseWrite(row.requestId,body.getBytes(StandardCharsets.UTF_8));server.responseEnd(row.requestId).get(4,TimeUnit.SECONDS);}
    private void rejected(String head,byte[] body,int status) throws Exception {
        SSLSocket socket=connect();write(socket,head);if(body!=null){socket.getOutputStream().write(body);socket.getOutputStream().flush();}
        String result=read(socket);assertTrue(result,result.startsWith("HTTP/1.1 "+status));assertTrue(result.contains("mcp-transport-failed"));assertNull(requests.poll(30,TimeUnit.MILLISECONDS));
    }
    private void empty() throws Exception {long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(server.pendingCount()!=0&&System.nanoTime()<end)Thread.sleep(10);assertEquals(0,server.pendingCount());}

    @Test public void realTlsRequiresExplicitCertificateAndIpSan() throws Exception {
        try{connect((SSLSocketFactory)SSLSocketFactory.getDefault(),"127.0.0.1");fail("untrusted self-signed leaf accepted");}catch(SSLException expected){}empty();
        try{connect(trusted(),"localhost");fail("wrong SAN accepted");}catch(SSLException expected){}empty();
        SSLSocket socket=connect();assertTrue(Arrays.asList("TLSv1.2","TLSv1.3").contains(socket.getSession().getProtocol()));
        X509Certificate cert=certificate();assertEquals("EC",cert.getPublicKey().getAlgorithm());assertEquals(-1,cert.getBasicConstraints());assertTrue(cert.getSubjectAlternativeNames().stream().anyMatch(value->value.get(0).equals(7)&&value.get(1).equals("127.0.0.1")));
        StringBuilder hash=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(cert.getPublicKey().getEncoded()))hash.append(String.format("%02x",value&255));assertEquals(hash.toString(),server.spkiSha256());
        String old=server.spkiSha256(),id=server.instanceId;socket.close();server.close();assertEquals(id,stopped.poll(2,TimeUnit.SECONDS));server.close();assertNull(stopped.poll());
        server=McpHttpsServer.start("127.0.0.1",events,()->true);assertNotEquals(old,server.spkiSha256());
    }
    @Test public void explicitAssignedPrivateAddressAndFailedStartStopEvent() throws Exception {
        for(String address:Arrays.asList("0.0.0.0","8.8.8.8","169.254.1.1","127.0.0.2","localhost","127.000.0.1","10.255.255.254","[::1]")){
            try{McpHttpsServer.checkedAddress(address);fail(address);}catch(Exception expected){assertEquals("mcp-transport-failed",expected.getMessage());}
        }
        try{McpHttpsServer.start("127.0.0.1",events,()->false);fail();}catch(Exception expected){assertEquals("mcp-transport-failed",expected.getMessage());}assertNotNull(stopped.poll(2,TimeUnit.SECONDS));assertNotNull(server.endpoint());
    }
    @Test public void parserPreservesActualHostCookieOriginAndBuffersUntilEnd() throws Exception {
        SSLSocket socket=request("{\"synthetic\":true}".getBytes(StandardCharsets.UTF_8),"Cookie: synthetic=only\r\nOrigin: https://synthetic.example\r\nX-Example: one\r\nX-Example: two\r\n");McpHttpsServer.Request row=take();
        assertEquals("actual.example:443",row.host);assertEquals("synthetic=only",row.headers.get("cookie"));assertEquals("https://synthetic.example",row.headers.get("origin"));assertEquals("one,two",row.headers.get("x-example"));assertEquals("POST",row.method);assertEquals("/mcp",row.path);
        server.responseStart(row.requestId,200,Collections.singletonMap("mcp-session-id","synthetic-session"));server.responseWrite(row.requestId,"{\"ok\":true}".getBytes(StandardCharsets.UTF_8));
        socket.setSoTimeout(150);try{socket.getInputStream().read();fail("partial success leaked before responseEnd");}catch(SocketTimeoutException expected){}socket.setSoTimeout(4000);
        server.responseEnd(row.requestId).get(4,TimeUnit.SECONDS);String result=read(socket);assertTrue(result.startsWith("HTTP/1.1 200"));assertTrue(result.contains("mcp-session-id: synthetic-session"));assertTrue(result.endsWith("{\"ok\":true}"));empty();assertNull(cancelled.poll());
        try{server.responseWrite(row.requestId,new byte[0]);fail();}catch(McpHttpsServer.Failure expected){assertEquals("mcp-transport-stale",expected.getMessage());}
    }
    @Test public void duplicateSensitiveHeadersAndFramingAmbiguityRejected() throws Exception {
        for(String name:Arrays.asList("Host","Authorization","Content-Length","Content-Type","Origin","Transfer-Encoding")){
            String headers="Host: actual.example\r\nContent-Length: 0\r\n";
            if(name.equals("Host"))headers+="Host: second.example\r\n";
            else if(name.equals("Content-Length"))headers+="Content-Length: 0\r\n";
            else if(name.equals("Transfer-Encoding"))headers="Host: actual.example\r\nTransfer-Encoding: chunked\r\nTransfer-Encoding: chunked\r\n";
            else headers+=name+": one\r\n"+name+": two\r\n";
            rejected("POST /mcp HTTP/1.1\r\n"+headers+"\r\n",null,400);
        }
        rejected("POST /mcp HTTP/1.1\r\nHost: actual.example\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n",null,400);
        rejected("POST https://actual.example/mcp HTTP/1.1\r\nHost: actual.example\r\nContent-Length: 0\r\n\r\n",null,400);
        rejected("POST /mcp?query=1 HTTP/1.1\r\nHost: actual.example\r\nContent-Length: 0\r\n\r\n",null,400);
        rejected("GET /mcp HTTP/1.1\r\nHost: actual.example\r\n\r\n",null,405);empty();
    }
    @Test public void bodyBoundaryDeclaredChunkedUtf8AndHeaderBudgets() throws Exception {
        byte[] exact=new byte[McpHttpsServer.REQUEST_LIMIT];Arrays.fill(exact,(byte)'x');SSLSocket socket=request(exact,"");McpHttpsServer.Request row=take();assertEquals(exact.length,row.body.length());reply(row,"{}");assertTrue(read(socket).startsWith("HTTP/1.1 200"));
        rejected("POST /mcp HTTP/1.1\r\nHost: actual.example\r\nContent-Length: 1000001\r\n\r\n",null,413);
        rejected("POST /mcp HTTP/1.1\r\nHost: actual.example\r\nContent-Length: 2\r\n\r\n",new byte[]{(byte)0xc3,0x28},400);
        SSLSocket chunked=connect();write(chunked,"POST /mcp HTTP/1.1\r\nHost: actual.example\r\nTransfer-Encoding: chunked\r\n\r\n"+Integer.toHexString(exact.length+1)+"\r\n");chunked.getOutputStream().write(exact);chunked.getOutputStream().write('x');chunked.getOutputStream().flush();assertTrue(read(chunked).startsWith("HTTP/1.1 413"));
        StringBuilder many=new StringBuilder("POST /mcp HTTP/1.1\r\nHost: actual.example\r\nContent-Length: 0\r\n");for(int i=0;i<63;i++)many.append("X-Test-").append(i).append(": v\r\n");rejected(many+"\r\n",null,400);
        char[] huge=new char[17000];Arrays.fill(huge,'x');rejected("POST /mcp HTTP/1.1\r\nHost: actual.example\r\nX-Test: "+new String(huge)+"\r\nContent-Length: 0\r\n\r\n",null,400);empty();
    }
    @Test public void responseRejectsRedirectCookiesCrLfAndOversizeWithoutPartialBytes() throws Exception {
        for(Map<String,String> headers:Arrays.asList(Collections.singletonMap("set-cookie","secret=no"),Collections.singletonMap("content-type","application/json\r\nInjected: yes"))){
            SSLSocket socket=request(new byte[0],"");McpHttpsServer.Request row=take();try{server.responseStart(row.requestId,200,headers);fail();}catch(McpHttpsServer.Failure expected){}assertEquals("",read(socket));assertEquals(row.requestId,cancelled.poll(2,TimeUnit.SECONDS));
        }
        SSLSocket redirect=request(new byte[0],"");McpHttpsServer.Request row=take();try{server.responseStart(row.requestId,302,Collections.emptyMap());fail();}catch(McpHttpsServer.Failure expected){}assertEquals("",read(redirect));assertEquals(row.requestId,cancelled.poll(2,TimeUnit.SECONDS));
        SSLSocket chunk=request(new byte[0],"");row=take();server.responseStart(row.requestId,200,Collections.emptyMap());try{server.responseWrite(row.requestId,new byte[McpHttpsServer.CHUNK_LIMIT+1]);fail();}catch(McpHttpsServer.Failure expected){}assertEquals("",read(chunk));assertEquals(row.requestId,cancelled.poll(2,TimeUnit.SECONDS));
        SSLSocket total=request(new byte[0],"");row=take();server.responseStart(row.requestId,200,Collections.emptyMap());for(int i=0;i<32;i++)server.responseWrite(row.requestId,new byte[McpHttpsServer.CHUNK_LIMIT]);try{server.responseWrite(row.requestId,new byte[]{1});fail();}catch(McpHttpsServer.Failure expected){}assertEquals("",read(total));assertEquals(row.requestId,cancelled.poll(2,TimeUnit.SECONDS));empty();
    }
    @Test public void fourFlightsDisconnectCancelStopAndLaterFreshStart() throws Exception {
        List<McpHttpsServer.Request> rows=new ArrayList<>();List<SSLSocket> held=new ArrayList<>();for(int i=0;i<4;i++){held.add(request(new byte[0],""));rows.add(take());}assertEquals(4,server.pendingCount());
        try{connect();fail("fifth connection accepted");}catch(IOException expected){}assertEquals(4,server.pendingCount());
        held.get(0).close();assertEquals(rows.get(0).requestId,cancelled.poll(3,TimeUnit.SECONDS));server.cancel(rows.get(1).requestId);assertEquals(rows.get(1).requestId,cancelled.poll(2,TimeUnit.SECONDS));
        SSLSocket fresh=request(new byte[0],"");McpHttpsServer.Request replacement=take();reply(replacement,"{}");read(fresh);
        String instance=server.instanceId;server.close();assertEquals(instance,stopped.poll(2,TimeUnit.SECONDS));Set<String> remaining=new HashSet<>(Arrays.asList(cancelled.poll(2,TimeUnit.SECONDS),cancelled.poll(2,TimeUnit.SECONDS)));assertEquals(new HashSet<>(Arrays.asList(rows.get(2).requestId,rows.get(3).requestId)),remaining);empty();
        try{server.cancel(replacement.requestId);fail();}catch(McpHttpsServer.Failure expected){}server.close();assertNull(stopped.poll());
    }
    @Test public void productionThirtySecondDeadlineCancelsAndReleasesSlot() throws Exception {
        long begin=System.nanoTime();SSLSocket socket=request(new byte[0],"");socket.setSoTimeout(35000);McpHttpsServer.Request row=take();
        assertEquals(row.requestId,cancelled.poll(34,TimeUnit.SECONDS));long millis=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-begin);assertTrue("deadline "+millis,millis>=28000&&millis<35000);assertTrue(read(socket).startsWith("HTTP/1.1 408"));empty();
        SSLSocket fresh=request(new byte[0],"");McpHttpsServer.Request next=take();reply(next,"{}");assertTrue(read(fresh).startsWith("HTTP/1.1 200"));
    }
    @Test public void incompleteBodyUsesSameTotalDeadlineBeforeJsDispatch() throws Exception {
        long begin=System.nanoTime();SSLSocket socket=connect();socket.setSoTimeout(35000);write(socket,"POST /pair HTTP/1.1\r\nHost: actual.example\r\nContent-Length: 2\r\n\r\nx");
        String result=read(socket);long millis=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-begin);assertTrue("deadline "+millis,millis>=28000&&millis<35000);assertTrue(result.startsWith("HTTP/1.1 408"));assertNull(requests.poll());assertNotNull(cancelled.poll(1,TimeUnit.SECONDS));empty();
    }
    @Test public void exactEightMiBResponseAndPairPathRoundTrip() throws Exception {
        SSLSocket socket=connect();write(socket,"POST /pair HTTP/1.1\r\nHost: actual.example\r\nContent-Length: 0\r\n\r\n");McpHttpsServer.Request row=take();assertEquals("/pair",row.path);
        server.responseStart(row.requestId,200,Collections.singletonMap("content-type","text/event-stream"));byte[] chunk=new byte[McpHttpsServer.CHUNK_LIMIT];Arrays.fill(chunk,(byte)'x');for(int i=0;i<32;i++)server.responseWrite(row.requestId,chunk);
        CompletableFuture<Void> ack=server.responseEnd(row.requestId);String result=read(socket);ack.get(4,TimeUnit.SECONDS);int split=result.indexOf("\r\n\r\n");assertTrue(split>0);assertEquals(McpHttpsServer.RESPONSE_LIMIT,result.length()-split-4);assertTrue(result.substring(0,split).contains("content-length: 8388608"));assertEquals('x',result.charAt(result.length()-1));empty();
    }
}
