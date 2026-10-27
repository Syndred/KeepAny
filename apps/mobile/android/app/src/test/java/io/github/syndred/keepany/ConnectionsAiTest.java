package io.github.syndred.keepany;

import static org.junit.Assert.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import okhttp3.*;
import okio.*;
import org.junit.Test;

/** Real native HTTP implementation with synthetic OkHttp responses; no server or credentials. */
public class ConnectionsAiTest {
    private static String id(){return UUID.randomUUID().toString();}
    private static File directory() throws IOException {File root=File.createTempFile("keepany-ai-",".tmp");if(!root.delete()||!root.mkdir())throw new IOException();return root;}
    private static Map<String,String> headers(){Map<String,String> values=new HashMap<>();values.put("content-type","application/json");values.put("authorization","Bearer synthetic");return values;}
    private static Response response(Interceptor.Chain chain,int status,ResponseBody body){return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("Synthetic").body(body).build();}
    private static ResponseBody body(byte[] bytes){return ResponseBody.create(bytes,MediaType.get("application/json"));}
    private static void empty(File root){assertEquals("AI never creates a cache file",0,Objects.requireNonNull(root.list()).length);assertTrue(root.delete());}
    private static void open(ConnectionsHttp http,String request,int timeout) throws IOException {http.aiOpen(request,"openai","https://ai.example.test/v1","synthetic",headers(),timeout);}
    @Test public void providerEndpointsAndLoopbackAreExplicitAndHeadersCannotReachOtherProtocols() throws Exception {
        for(String provider:Arrays.asList("openai","deepseek","qwen","doubao","moonshot","openrouter","compatible","ollama"))assertEquals("https://ai.example.test/v1/chat/completions",ConnectionsHttp.aiTarget(provider,"https://ai.example.test/v1/chat/completions/","synthetic").toString());
        for(String provider:Arrays.asList("anthropic","minimax"))assertEquals("https://ai.example.test/v1/messages",ConnectionsHttp.aiTarget(provider,"https://ai.example.test/v1","synthetic").toString());
        assertEquals("https://ai.example.test/v1/models/synthetic:generateContent",ConnectionsHttp.aiTarget("google","https://ai.example.test/v1","synthetic").toString());
        for(String host:Arrays.asList("localhost","127.0.0.1","[::1]"))assertEquals("http://"+host+":11434/v1/chat/completions",ConnectionsHttp.aiTarget("ollama","http://"+host+":11434/v1","synthetic").toString());
        for(String host:Arrays.asList("localhost","127.0.0.1","[::1]")) {
            assertEquals("http://"+host+":11434/v1/chat/completions",ConnectionsHttp.aiTarget("compatible","http://"+host+":11434/v1/chat/completions","synthetic").toString());
            assertEquals("http://"+host+":11434/v1/messages",ConnectionsHttp.aiTarget("anthropic","http://"+host+":11434/v1","synthetic").toString());
        }
        for(String base:Arrays.asList("http://192.168.1.2:11434/v1","http://localhost.evil.test","http://127.0.0.2/v1","https://user:pass@ai.example.test","https://ai.example.test?q=x","file:///tmp/ai"))try{ConnectionsHttp.aiTarget("ollama",base,"synthetic");fail();}catch(IOException expected){}
        try{ConnectionsHttp.aiTarget("google","https://ai.example.test/v1","../../outside");fail();}catch(IOException expected){}
        File root=directory();try(ConnectionsHttp http=new ConnectionsHttp(root)) {
            Map<String,String> bad=headers();bad.put("cookie","never");try{http.aiOpen(id(),"openai","https://ai.example.test","synthetic",bad,30000);fail();}catch(IOException expected){}
            String request=id();open(http,request,120000);try{open(http,id(),120000);fail();}catch(IOException expected){}
            try{http.aiWrite(request,new byte[ConnectionsHttp.CHUNK+1]);fail();}catch(IOException expected){}
            http.aiCancel(request);try{open(http,request,120000);fail();}catch(IOException expected){}
            String next=id();open(http,next,120000);http.aiCancel(next);
        }finally{empty(root);}
    }
    @Test public void maximumImageBytesStayInMemoryAndCookieHeadersNeverEnterTheAiRequest() throws Exception {
        File root=directory();AtomicReference<byte[]> sent=new AtomicReference<>();AtomicLong timeout=new AtomicLong();AtomicReference<CookieJar> cookieJar=new AtomicReference<>();
        try(ConnectionsHttp http=new ConnectionsHttp(root,cookies->{cookieJar.set(cookies);return ConnectionsHttp.client(cookies).newBuilder().addInterceptor(chain->{
            assertEquals("POST",chain.request().method());assertNull(chain.request().header("Cookie"));assertNull(chain.request().header("Origin"));
            timeout.set(TimeUnit.NANOSECONDS.toMillis(chain.call().timeout().timeoutNanos()));Buffer buffer=new Buffer();chain.request().body().writeTo(buffer);sent.set(buffer.readByteArray());
            return response(chain,200,body("{\"synthetic\":true}".getBytes(StandardCharsets.UTF_8)));
        }).build();})) {
            byte[] bytes=new byte[14_000_002];Arrays.fill(bytes,(byte)'A');bytes[0]='"';bytes[bytes.length-1]='"';String request=id();open(http,request,120000);
            for(int at=0;at<bytes.length;at+=ConnectionsHttp.CHUNK)http.aiWrite(request,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+ConnectionsHttp.CHUNK)));
            ConnectionsHttp.Result result=http.aiRequest(request);assertArrayEquals(bytes,sent.get());assertSame(CookieJar.NO_COOKIES,cookieJar.get());assertTrue("not the legacy 30s cap",timeout.get()>110000);
            assertNull("no large body in bridge reply",result.body);assertEquals(18,result.size);assertEquals("{\"synthetic\":true}",new String(http.aiRead(request,0),StandardCharsets.UTF_8));
            http.aiCancel(request);try{http.aiRead(request,0);fail();}catch(IOException expected){}
        }finally{empty(root);}
    }
    @Test public void inputBudgetAndExpiredStagingRejectBeforeAnyNetworkAndCannotRevive() throws Exception {
        File root=directory();AtomicInteger sent=new AtomicInteger();try(ConnectionsHttp http=new ConnectionsHttp(root,cookies->{sent.incrementAndGet();return ConnectionsHttp.client(cookies);})) {
            String request=id();open(http,request,120000);byte[] chunk=new byte[ConnectionsHttp.CHUNK];for(int n=0;n<64;n++)http.aiWrite(request,chunk);
            try{http.aiWrite(request,new byte[]{1});fail();}catch(IOException expected){}http.aiCancel(request);
            String expired=id();open(http,expired,1);Thread.sleep(10);try{http.aiWrite(expired,new byte[]{1});fail();}catch(IOException expected){assertEquals("TIMEOUT",ConnectionsHttp.aiFailureCode(expected));}http.aiCancel(expired);
            assertEquals(0,sent.get());
        }finally{empty(root);}
    }
    private static ResponseBody streaming(long declared,long actual,AtomicBoolean closed) {
        BufferedSource source=Okio.buffer(new Source(){long remaining=actual;final byte[] zero=new byte[8192];public long read(Buffer sink,long count){if(remaining==0)return -1;int size=(int)Math.min(Math.min(count,remaining),zero.length);sink.write(zero,0,size);remaining-=size;return size;}public Timeout timeout(){return Timeout.NONE;}public void close(){closed.set(true);}});
        return new ResponseBody(){public MediaType contentType(){return MediaType.get("application/json");}public long contentLength(){return declared;}public BufferedSource source(){return source;}};
    }
    @Test public void declaredAndActualResponseLimitsCloseSourcesAndAllowTheNextCall() throws Exception {
        for(boolean declared:new boolean[]{true,false}) {
            File root=directory();AtomicBoolean closed=new AtomicBoolean();try(ConnectionsHttp http=new ConnectionsHttp(root,cookies->ConnectionsHttp.client(cookies).newBuilder().addInterceptor(chain->response(chain,200,streaming(declared?(long)ConnectionsHttp.AI_OUTPUT_LIMIT+1:-1,(long)ConnectionsHttp.AI_OUTPUT_LIMIT+1,closed))).build())) {
                for(int attempt=0;attempt<2;attempt++){String request=id();open(http,request,30000);http.aiWrite(request,new byte[]{'{','}'});try{http.aiRequest(request);fail();}catch(IOException expected){assertEquals("native-ai-failed",ConnectionsHttp.aiFailureCode(expected));}finally{http.aiCancel(request);}assertTrue(closed.get());}
            }finally{empty(root);}
        }
    }
    @Test public void cancelTerminatesNativeFlightAndDoesNotLeaveAnAiSlotOrResponse() throws Exception {
        File root=directory();CountDownLatch entered=new CountDownLatch(1);AtomicBoolean closed=new AtomicBoolean();ExecutorService workers=Executors.newSingleThreadExecutor();
        try(ConnectionsHttp http=new ConnectionsHttp(root,cookies->ConnectionsHttp.client(cookies).newBuilder().addInterceptor(chain->{entered.countDown();while(!chain.call().isCanceled())try{Thread.sleep(5);}catch(InterruptedException error){Thread.currentThread().interrupt();throw new IOException();}closed.set(true);throw new IOException("private synthetic cancellation");}).build())) {
            String request=id();open(http,request,120000);http.aiWrite(request,new byte[]{'{','}'});Future<?> pending=workers.submit(()->{try{http.aiRequest(request);throw new AssertionError();}catch(IOException expected){assertEquals("native-ai-failed",ConnectionsHttp.aiFailureCode(expected));}});
            assertTrue(entered.await(2,TimeUnit.SECONDS));http.aiCancel(request);pending.get(2,TimeUnit.SECONDS);assertTrue(closed.get());
            try{http.aiRead(request,0);fail();}catch(IOException expected){}String next=id();open(http,next,1000);http.aiCancel(next);
        }finally{workers.shutdownNow();assertTrue(workers.awaitTermination(2,TimeUnit.SECONDS));empty(root);}
    }
    @Test public void redirectAndTlsFailuresRemainSanitizedAndHttpAuthenticationRemainsAStatus() throws Exception {
        for(int status:new int[]{307,401,500}) {
            File root=directory();try(ConnectionsHttp http=new ConnectionsHttp(root,cookies->ConnectionsHttp.client(cookies).newBuilder().addInterceptor(chain->response(chain,status,body(new byte[0]))).build())) {
                String request=id();open(http,request,30000);http.aiWrite(request,new byte[]{'{','}'});try{ConnectionsHttp.Result result=http.aiRequest(request);assertNotEquals(307,status);assertEquals(status,result.status);}catch(IOException expected){assertEquals(307,status);assertEquals("native-ai-failed",ConnectionsHttp.aiFailureCode(expected));}finally{http.aiCancel(request);}
            }finally{empty(root);}
        }
        for(Throwable error:new Throwable[]{new javax.net.ssl.SSLHandshakeException("private certificate"),new IOException("private credentials"),new RuntimeException("TIMEOUT")})assertEquals("native-ai-failed",ConnectionsHttp.aiFailureCode(error));
    }
    @Test public void aiCannotReadOrClearSessionCookiesOrBackupTransfers() throws Exception {
        File root=directory();AtomicReference<CookieJar> last=new AtomicReference<>();try(ConnectionsHttp http=new ConnectionsHttp(root,cookies->{last.set(cookies);return ConnectionsHttp.client(cookies).newBuilder().addInterceptor(chain->response(chain,200,body(new byte[]{'{','}'}))).build();})) {
            String owner=http.openSession("https://ai.example.test");http.sessionRequest(id(),owner,"https://ai.example.test/api/auth/get-session","GET",Collections.emptyMap(),new byte[0]);
            CookieJar session=last.get();HttpUrl url=HttpUrl.get("https://ai.example.test/");session.saveFromResponse(url,Collections.singletonList(new Cookie.Builder().name("session").value("synthetic").hostOnlyDomain("ai.example.test").secure().path("/").build()));
            String backup=id();http.backupWrite(backup,new byte[]{1,2,3});
            String request=id();open(http,request,30000);http.aiWrite(request,new byte[]{'{','}'});http.aiRequest(request);assertSame(CookieJar.NO_COOKIES,last.get());http.aiCancel(request);
            http.aiCancel(backup); // Even a mismatched AI cancellation cannot poison a backup request ID.
            assertEquals(1,session.loadForRequest(url).size());assertArrayEquals(new byte[]{1,2,3},http.backupRead(backup,0));
            http.cancel(backup);http.closeSession(owner);assertTrue(session.loadForRequest(url).isEmpty());
        }finally{empty(root);}
    }
    @Test public void totalTimeoutCancelsTheUnderlyingCallAndReleasesTheAiSlot() throws Exception {
        File root=directory();AtomicBoolean entered=new AtomicBoolean(),cancelled=new AtomicBoolean();
        try(ConnectionsHttp http=new ConnectionsHttp(root,cookies->ConnectionsHttp.client(cookies).newBuilder().addInterceptor(chain->{
            entered.set(true);long guard=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);
            while(!chain.call().isCanceled()&&System.nanoTime()<guard)try{Thread.sleep(5);}catch(InterruptedException error){Thread.currentThread().interrupt();throw new IOException();}
            cancelled.set(chain.call().isCanceled());throw new IOException("private synthetic timeout");
        }).build())) {
            String request=id();open(http,request,1000);http.aiWrite(request,new byte[]{'{','}'});
            try{http.aiRequest(request);fail();}catch(IOException expected){assertEquals("TIMEOUT",ConnectionsHttp.aiFailureCode(expected));}
            assertTrue("real OkHttp call entered",entered.get());assertTrue("OkHttp timeout cancelled the call",cancelled.get());
            http.aiCancel(request);String next=id();open(http,next,1000);http.aiCancel(next);
        }finally{empty(root);}
    }
    @Test public void abandonedDraftsAndCompletedResponsesExpireWithoutJavascriptCleanup() throws Exception {
        for(boolean completed:new boolean[]{false,true}) {
            File root=directory();try(ConnectionsHttp http=new ConnectionsHttp(root,cookies->ConnectionsHttp.client(cookies).newBuilder().addInterceptor(chain->response(chain,200,body(new byte[]{'{','}'}))).build())) {
                String old=id();open(http,old,100);http.aiWrite(old,new byte[]{'{','}'});if(completed)http.aiRequest(old);
                String next=id();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
                while(true)try{open(http,next,30000);break;}catch(IOException pending){if(System.nanoTime()>=deadline)throw new AssertionError("expired AI state held the slot",pending);Thread.sleep(10);}
                try{http.aiRead(old,0);fail();}catch(IOException expected){assertEquals("TIMEOUT",ConnectionsHttp.aiFailureCode(expected));}
                http.aiCancel(old);http.aiWrite(next,new byte[]{'{','}'});http.aiCancel(next);
            }finally{empty(root);}
        }
    }
}
