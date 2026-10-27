package io.github.syndred.keepany;

import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.cert.CertificateFactory;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.*;
import okhttp3.*;
import org.junit.*;

/** Opt-in Windows JVM HTTPS contract. No Android/system CA trust is changed. */
public class ConnectionsHttpsTest {
    private static File fixture;
    private static Properties values;
    private static SSLSocketFactory socketFactory;
    private static X509TrustManager trust;
    private static String origin;
    private static byte[] ciphertext, plainDigest, nonce;
    private static SecretKey key;
    private static String id(){return UUID.randomUUID().toString();}
    private static String value(String name){String value=values.getProperty(name);if(value==null||value.isEmpty())throw new IllegalStateException("fixture-property-missing");return value;}
    private static File directory() throws IOException {File result=File.createTempFile("keepany-jvm-https-",".tmp");if(!result.delete()||!result.mkdir())throw new IOException("fixture-directory");return result;}
    @BeforeClass public static void configure() throws Exception {
        String path=System.getenv("KEEPANY_HTTPS_FIXTURE_DIR");Assume.assumeTrue("Explicit private HTTPS fixture required; not a Native test",path!=null&&!path.isEmpty());fixture=new File(path);
        values=new Properties();try(Reader input=new InputStreamReader(new FileInputStream(new File(fixture,"fixture-private.properties")),StandardCharsets.UTF_8)){values.load(input);}
        origin=value("origin");assertEquals("fixture origin", "https://keepany-native.test:9445",origin);
        KeyStore store=KeyStore.getInstance(KeyStore.getDefaultType());store.load(null,null);
        try(InputStream ca=new FileInputStream(new File(fixture,"ca.pem"))){store.setCertificateEntry("fixture-only-ca",CertificateFactory.getInstance("X.509").generateCertificate(ca));}
        TrustManagerFactory manager=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());manager.init(store);
        for(TrustManager candidate:manager.getTrustManagers())if(candidate instanceof X509TrustManager)trust=(X509TrustManager)candidate;
        if(trust==null)throw new IllegalStateException("fixture-trust-manager");
        SSLContext context=SSLContext.getInstance("TLS");context.init(null,new TrustManager[]{trust},new SecureRandom());socketFactory=context.getSocketFactory();
        byte[] plain=new byte[4*1024*1024];new SecureRandom().nextBytes(plain);plainDigest=MessageDigest.getInstance("SHA-256").digest(plain);
        KeyGenerator generator=KeyGenerator.getInstance("AES");generator.init(256);key=generator.generateKey();nonce=new byte[12];new SecureRandom().nextBytes(nonce);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key,new GCMParameterSpec(128,nonce));ciphertext=cipher.doFinal(plain);Arrays.fill(plain,(byte)0);
        control(0,false,false);
    }
    private static List<InetAddress> dns(String host) throws UnknownHostException {
        if(!Arrays.asList("keepany-native.test","backup-native.test","wrong-native.test").contains(host))throw new UnknownHostException("fixture-host-refused");
        return Collections.singletonList(InetAddress.getByAddress(new byte[]{127,0,0,1}));
    }
    private static ConnectionsHttp.ClientFactory clients(boolean trusted,CountDownLatch sent) {
        return cookies->{OkHttpClient.Builder builder=ConnectionsHttp.client(cookies).newBuilder().dns(ConnectionsHttpsTest::dns);
            if(trusted)builder.sslSocketFactory(socketFactory,trust);
            if(sent!=null)builder.eventListener(new okhttp3.EventListener(){@Override public void requestHeadersEnd(Call call,Request request){sent.countDown();}});
            // Keep the production hostname verifier and all production redirect,
            // credential, cookie, byte and timeout policies unchanged.
            return builder.build();};
    }
    private static String json(String text){return "\""+text.replace("\\","\\\\").replace("\"","\\\"").replace("\r","\\r").replace("\n","\\n")+"\"";}
    private static ConnectionsHttp.Result session(ConnectionsHttp http,String owner,String route,String method,String body) throws IOException {
        return http.sessionRequest(id(),owner,origin+route,method,body==null?Collections.emptyMap():Collections.singletonMap("content-type","application/json"),body==null?new byte[0]:body.getBytes(StandardCharsets.UTF_8));
    }
    private static ConnectionsHttp.Result accountRequest(ConnectionsHttp http,String owner,int account,String route,String method,String body) throws IOException {
        Map<String,String> headers=new HashMap<>();headers.put("x-keepany-account-id",value("account."+account+".accountId"));if(body!=null)headers.put("content-type","application/json");
        return http.sessionRequest(id(),owner,origin+route,method,headers,body==null?new byte[0]:body.getBytes(StandardCharsets.UTF_8));
    }
    private static void login(ConnectionsHttp http,String owner,int account) throws IOException {
        ConnectionsHttp.Result reply=session(http,owner,"/api/auth/sign-in/email","POST","{\"email\":"+json(value("account."+account+".email"))+",\"password\":"+json(value("account."+account+".password"))+"}");
        assertEquals("real sign-in status",200,reply.status);assertTrue("cookie headers stay native",reply.headers.keySet().stream().noneMatch(name->name.toLowerCase(Locale.ROOT).contains("cookie")));
    }
    private static void identity(ConnectionsHttp http,String owner,int account) throws IOException {
        ConnectionsHttp.Result reply=session(http,owner,"/sync/identity","POST","{}");assertEquals("authenticated identity status",200,reply.status);
        String body=new String(reply.body,StandardCharsets.UTF_8);assertTrue("authenticated account matches",Pattern.compile("\"accountId\"\\s*:\\s*"+Pattern.quote(json(value("account."+account+".accountId")))).matcher(body).find());
    }
    private static void workspace(ConnectionsHttp http,String owner,int account) throws IOException {
        assertEquals("workspace route requires the authenticated account header",401,session(http,owner,"/workspaces","GET",null).status);
        ConnectionsHttp.Result list=accountRequest(http,owner,account,"/workspaces","GET",null);assertEquals("workspace list status",200,list.status);
        String body=new String(list.body,StandardCharsets.UTF_8);assertTrue("own workspace listed",body.contains(value("account."+account+".workspaceId")));assertFalse("other workspace not listed",body.contains(value("account."+(1-account)+".workspaceId")));
        assertEquals("own workspace authorized",200,accountRequest(http,owner,account,"/sync/preflight","POST","{\"workspaceId\":"+json(value("account."+account+".workspaceId"))+"}").status);
        assertEquals("another account workspace forbidden",403,accountRequest(http,owner,account,"/sync/preflight","POST","{\"workspaceId\":"+json(value("account."+(1-account)+".workspaceId"))+"}").status);
    }
    @Test public void realBetterAuthCookieIdentityWorkspaceIsolationLogoutAndFreshInstances() throws Exception {
        File root=directory();try(ConnectionsHttp http=new ConnectionsHttp(root,clients(true,null))){
            String owner=http.openSession(origin);assertEquals("anonymous identity rejected",401,session(http,owner,"/sync/identity","POST","{}").status);
            assertEquals("wrong password rejected",401,session(http,owner,"/api/auth/sign-in/email","POST","{\"email\":"+json(value("account.0.email"))+",\"password\":\"deliberately-wrong-synthetic-password\"}").status);
            login(http,owner,0);identity(http,owner,0);workspace(http,owner,0);
            assertEquals("real sign-out status",200,session(http,owner,"/api/auth/sign-out","POST","{}").status);
            assertEquals("sign-out removes authorization",401,session(http,owner,"/sync/identity","POST","{}").status);
            http.closeSession(owner);owner=http.openSession(origin);assertEquals("new process session has no cookie",401,session(http,owner,"/sync/identity","POST","{}").status);
            login(http,owner,1);identity(http,owner,1);workspace(http,owner,1);http.closeSession(owner);
            owner=http.openSession(origin);assertEquals("close clears authenticated cookies",401,session(http,owner,"/sync/identity","POST","{}").status);
        }finally{assertTrue("session wrote no cache files",Objects.requireNonNull(root.list()).length==0);assertTrue(root.delete());}
        File next=directory();try(ConnectionsHttp http=new ConnectionsHttp(next,clients(true,null))){String owner=http.openSession(origin);assertEquals("new instance has no global cookie",401,session(http,owner,"/sync/identity","POST","{}").status);}finally{assertTrue(next.delete());}
    }
    private static Map<String,String> davHeaders(){String basic=Base64.getEncoder().encodeToString((value("webdavUser")+":"+value("webdavPassword")).getBytes(StandardCharsets.UTF_8));return Collections.singletonMap("authorization","Basic "+basic);}
    private static int put(ConnectionsHttp http,String url,Map<String,String> headers,byte[] bytes) throws IOException {
        String request=id();try{for(int offset=0;offset<bytes.length;offset+=ConnectionsHttp.CHUNK)http.backupWrite(request,Arrays.copyOfRange(bytes,offset,Math.min(bytes.length,offset+ConnectionsHttp.CHUNK)));return http.backupRequest(request,url,"PUT",headers).status;}finally{http.cancel(request);}
    }
    private static byte[] get(ConnectionsHttp http,String url,Map<String,String> headers) throws IOException {
        return get(http,url,headers,true);
    }
    private static byte[] get(ConnectionsHttp http,String url,Map<String,String> headers,boolean expectedSize) throws IOException {
        String request=id();try{ConnectionsHttp.Result response=http.backupRequest(request,url,"GET",headers);assertEquals("remote get status",200,response.status);if(expectedSize)assertEquals("remote ciphertext size",ciphertext.length,response.size);
            ByteArrayOutputStream result=new ByteArrayOutputStream();for(long offset=0;offset<response.size;){byte[] chunk=http.backupRead(request,offset);assertTrue("bounded nonempty bridge chunk",chunk.length>0&&chunk.length<=ConnectionsHttp.CHUNK);result.write(chunk);offset+=chunk.length;}return result.toByteArray();
        }finally{http.cancel(request);}
    }
    private static void exact(byte[] received) throws Exception {
        assertTrue("ciphertext bytes preserved",MessageDigest.isEqual(ciphertext,received));Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,nonce));byte[] opened=cipher.doFinal(received);assertTrue("AES-GCM plaintext digest preserved",MessageDigest.isEqual(plainDigest,MessageDigest.getInstance("SHA-256").digest(opened)));Arrays.fill(opened,(byte)0);
    }
    @Test public void s3AndWebDavTransferRealFourMiBEncryptedBytesAndRefuseWrongCredentials() throws Exception {
        File root=directory();try(ConnectionsHttp http=new ConnectionsHttp(root,clients(true,null))){
            assertTrue("S3 PUT success",Arrays.asList(200,201,204).contains(put(http,value("s3Put"),Collections.emptyMap(),ciphertext)));exact(get(http,value("s3Get"),Collections.emptyMap()));
            assertTrue("WebDAV PUT success",Arrays.asList(200,201,204).contains(put(http,value("webdavUrl"),davHeaders(),ciphertext)));exact(get(http,value("webdavUrl"),davHeaders()));
            String request=id();try{assertEquals("WebDAV without credentials rejected",401,http.backupRequest(request,value("webdavUrl"),"GET",Collections.emptyMap()).status);}finally{http.cancel(request);}
        }finally{assertEquals("all ciphertext temporary files cleaned",0,Objects.requireNonNull(root.list()).length);assertTrue(root.delete());}
    }
    private static void control(int delay,boolean fail,boolean corrupt) throws IOException {
        Path target=new File(fixture,"control.json").toPath(), temporary=new File(fixture,"jvm-control-"+id()+".tmp").toPath();
        try{Files.writeString(temporary,"{\"delayMs\":"+delay+",\"failNextPut\":"+fail+",\"corruptNextGet\":"+corrupt+"}",StandardCharsets.UTF_8);
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
            while(true)try{Files.move(temporary,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);break;}
            catch(AccessDeniedException busy){if(System.nanoTime()>=deadline)throw busy;try{Thread.sleep(10);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new IOException("fixture-control-interrupted");}}
        }finally{Files.deleteIfExists(temporary);}
    }
    @Test public void realFailedPutCorruptReadAndCancellationRemainFailuresAndReleaseFiles() throws Exception {
        File root=directory();ExecutorService worker=Executors.newFixedThreadPool(2);boolean fastCancellation=true;long cancellationMs=0;
        try(ConnectionsHttp http=new ConnectionsHttp(root,clients(true,null))){
            assertTrue(Arrays.asList(200,201,204).contains(put(http,value("s3Put"),Collections.emptyMap(),ciphertext)));
            control(0,true,false);assertEquals("server failure stays failure",503,put(http,value("s3Put"),Collections.emptyMap(),new byte[]{1,2,3}));control(0,false,false);exact(get(http,value("s3Get"),Collections.emptyMap()));
            control(0,false,true);byte[] corrupted=get(http,value("s3Get"),Collections.emptyMap(),false);assertFalse("reference integrity detects corruption",MessageDigest.isEqual(ciphertext,corrupted));control(0,false,false);exact(get(http,value("s3Get"),Collections.emptyMap()));
            CountDownLatch sent=new CountDownLatch(1);String request=id();
            try(ConnectionsHttp slow=new ConnectionsHttp(root,clients(true,sent))){
                AtomicReference<Thread> reading=new AtomicReference<>(),cancelling=new AtomicReference<>();
                control(10000,false,false);Future<ConnectionsHttp.Result> pending=worker.submit(()->{reading.set(Thread.currentThread());return slow.backupRequest(request,value("s3Get"),"GET",Collections.emptyMap());});
                assertTrue("real HTTPS request headers reached the socket",sent.await(8,TimeUnit.SECONDS));
                long readingDeadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
                while(System.nanoTime()<readingDeadline&&!Arrays.stream(reading.get().getStackTrace()).anyMatch(frame->frame.getClassName().contains("Socket")&&frame.getMethodName().toLowerCase(Locale.ROOT).contains("read")))Thread.sleep(5);
                long started=System.nanoTime();Future<?> cancelled=worker.submit(()->{cancelling.set(Thread.currentThread());slow.cancel(request);});
                try{cancelled.get(1500,TimeUnit.MILLISECONDS);}catch(TimeoutException timeout){fastCancellation=false;StringBuilder trace=new StringBuilder();
                    for(Thread thread:Arrays.asList(reading.get(),cancelling.get())){if(thread==null)continue;trace.append("role=").append(thread==reading.get()?"network":"cancel").append(" state=").append(thread.getState()).append('\n');for(StackTraceElement frame:thread.getStackTrace())trace.append(frame).append('\n');}
                    Files.writeString(new File(fixture,"jvm-cancel-sample.txt").toPath(),trace.toString(),StandardCharsets.UTF_8);cancelled.get(15,TimeUnit.SECONDS);
                }
                cancellationMs=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started);
                try{pending.get(5,TimeUnit.SECONDS);fail("cancelled request must not succeed");}catch(ExecutionException expected){assertTrue("cancelled socket fails",expected.getCause() instanceof IOException);}
                try{slow.backupRead(request,0);fail("cancelled ciphertext file unavailable");}catch(IOException expected){}
                try{slow.backupWrite(request,new byte[]{1});fail("cancelled ID cannot revive");}catch(IOException expected){}
            }
        }finally{control(0,false,false);worker.shutdownNow();assertTrue(worker.awaitTermination(5,TimeUnit.SECONDS));assertEquals("failure temporary files cleaned",0,Objects.requireNonNull(root.list()).length);assertTrue(root.delete());}
        Files.writeString(new File(fixture,"jvm-cancel-timing.json").toPath(),"{\"cancelReturnedWithin1500ms\":"+fastCancellation+",\"elapsedMs\":"+cancellationMs+"}",StandardCharsets.UTF_8);
        assertTrue("cancel itself must return within 1500ms",fastCancellation);
    }
    private static boolean causedBy(Throwable error,Class<? extends Throwable> kind){for(Throwable next=error;next!=null;next=next.getCause())if(kind.isInstance(next))return true;return false;}
    @Test public void realTlsRejectsUntrustedCaAndWrongHostnameWithoutChangingProductionVerification() throws Exception {
        File root=directory();try(ConnectionsHttp http=new ConnectionsHttp(root,clients(false,null))){String owner=http.openSession(origin);try{session(http,owner,"/api/auth/get-session","GET",null);fail("untrusted certificate must fail");}catch(IOException expected){assertTrue("TLS trust rejection",causedBy(expected,SSLHandshakeException.class));}}finally{assertTrue(root.delete());}
        root=directory();try(ConnectionsHttp http=new ConnectionsHttp(root,clients(true,null))){String wrong=origin.replace("keepany-native.test","wrong-native.test"),owner=http.openSession(wrong);try{http.sessionRequest(id(),owner,wrong+"/api/auth/get-session","GET",Collections.emptyMap(),new byte[0]);fail("wrong hostname must fail");}catch(IOException expected){assertTrue("default hostname verification rejection",causedBy(expected,SSLPeerUnverifiedException.class));}}finally{assertTrue(root.delete());}
    }
}
