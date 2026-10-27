package io.github.syndred.keepany;
import static org.junit.Assert.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.*;
import okio.*;
import org.junit.Test;

public class ConnectionsHttpTest {
    private static ConnectionsHttp oversized(File root, long declared, long actual, AtomicBoolean closed) {
        return new ConnectionsHttp(root, cookies -> ConnectionsHttp.client(cookies).newBuilder().addInterceptor(chain -> {
            BufferedSource source=Okio.buffer(new Source() {
                long remaining=actual; final byte[] zero=new byte[8192];
                public long read(Buffer sink,long count) { if(remaining==0)return -1;int size=(int)Math.min(Math.min(count,zero.length),remaining);sink.write(zero,0,size);remaining-=size;return size; }
                public Timeout timeout(){return Timeout.NONE;}
                public void close(){closed.set(true);}
            });
            ResponseBody body=new ResponseBody() {
                public MediaType contentType(){return MediaType.get("application/octet-stream");}
                public long contentLength(){return declared;}
                public BufferedSource source(){return source;}
            };
            return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("Synthetic").body(body).build();
        }).build());
    }
    private static void assertBackupOverflow(boolean declared) throws Exception {
            File root=directory("keepany-connection-limit");AtomicBoolean closed=new AtomicBoolean();String request=id();
            try(ConnectionsHttp http=oversized(root,declared?(long)ConnectionsHttp.BACKUP_LIMIT+1:-1,(long)ConnectionsHttp.BACKUP_LIMIT+1,closed)) {
                try { http.backupRequest(request,"https://backup.example.test/object.ka1","GET",Collections.emptyMap());fail("oversize must fail"); }
                catch(IOException expected){ assertEquals("native-connections-limit",expected.getMessage());assertEquals("native-connections-limit",ConnectionsHttp.failureCode(expected)); }
                finally { http.cancel(request); }
                assertTrue("response source closed",closed.get());
                assertEquals("failed transfer removed",0,Objects.requireNonNull(root.list()).length);
                try {http.backupRead(request,0);fail("cancelled transfer cannot be read");}catch(IOException expected){}
            } finally { assertTrue(root.delete()); }
    }
    @Test public void declaredBackupOverflowHasStableLimitErrorAndReleasesResources() throws Exception { assertBackupOverflow(true); }
    @Test public void accumulatedBackupOverflowHasStableLimitErrorAndReleasesResources() throws Exception { assertBackupOverflow(false); }
    @Test public void failureCodesNeverExposeTlsAuthenticationOrUnknownExceptionDetails() {
        for(Throwable error:new Throwable[]{new javax.net.ssl.SSLHandshakeException("private certificate detail"),new IOException("private auth detail"),new RuntimeException("native-connections-limit"),new ConnectionsHttp.Failure()})
            assertEquals("native-connections-failed",ConnectionsHttp.failureCode(error));
        assertEquals("native-connections-limit",ConnectionsHttp.failureCode(new ConnectionsHttp.LimitFailure()));
    }
    @Test public void repeatedDeclaredOverflowReleasesAllActiveCallSlots() throws Exception {
        File root=directory("keepany-connection-limit-slots");AtomicBoolean closed=new AtomicBoolean();
        try(ConnectionsHttp http=oversized(root,(long)ConnectionsHttp.BACKUP_LIMIT+1,0,closed)) {
            for(int attempt=0;attempt<6;attempt++) {
                String request=id();closed.set(false);
                try {http.backupRequest(request,"https://backup.example.test/object.ka1","GET",Collections.emptyMap());fail();}
                catch(IOException expected){assertEquals("native-connections-limit",ConnectionsHttp.failureCode(expected));}
                finally {http.cancel(request);}
                assertTrue(closed.get());
            }
            assertEquals(0,Objects.requireNonNull(root.list()).length);
        }finally{assertTrue(root.delete());}
    }
    @Test public void oversizedUploadAcknowledgementIsNotMisreportedAsAnOversizedBackupFile() throws Exception {
        File root=directory("keepany-connection-ack-limit");String request=id();
        try(ConnectionsHttp http=fake(root,new AtomicReference<>(),200,new byte[8193])) {
            http.backupWrite(request,new byte[]{1});
            try {http.backupRequest(request,"https://backup.example.test/object.ka1","PUT",Collections.emptyMap());fail();}
            catch(IOException expected){assertEquals("native-connections-failed",ConnectionsHttp.failureCode(expected));}
            finally {http.cancel(request);}
            assertEquals(0,Objects.requireNonNull(root.list()).length);
        }finally{assertTrue(root.delete());}
    }
    private static String id(){return UUID.randomUUID().toString();}
    private static File directory(String prefix) throws IOException {File result=File.createTempFile(prefix,".tmp");if(!result.delete()||!result.mkdir())throw new IOException();return result;}
    private static ConnectionsHttp fake(File root, AtomicReference<CookieJar> jar, int status, byte[] body) {
        return new ConnectionsHttp(root, cookies->{jar.set(cookies);return ConnectionsHttp.client(cookies).newBuilder().addInterceptor(chain->new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("Synthetic").body(ResponseBody.create(body,MediaType.get("application/octet-stream"))).build()).build();});
    }
    @Test public void explicitOriginAndRoutePolicyRejectRedirectsAndWrongOrigins() throws Exception {
        File root=directory("keepany-connection-policy");try(ConnectionsHttp http=fake(root,new AtomicReference<>(),302,new byte[0])) {
            try{http.openSession("http://example.test");fail();}catch(IOException expected){}
            String session=http.openSession("https://example.test");
            try{http.sessionRequest(id(),session,"https://evil.test/api/auth/get-session","GET",Collections.emptyMap(),new byte[0]);fail();}catch(IOException expected){}
            try{http.sessionRequest(id(),session,"https://example.test/api/auth/delete-user","POST",Collections.emptyMap(),new byte[0]);fail();}catch(IOException expected){}
            try{http.sessionRequest(id(),session,"https://example.test/api/auth/get-session","GET",Collections.emptyMap(),new byte[0]);fail();}catch(IOException expected){}
            assertFalse(ConnectionsHttp.client(CookieJar.NO_COOKIES).followRedirects());assertFalse(ConnectionsHttp.client(CookieJar.NO_COOKIES).followSslRedirects());
        }finally{root.delete();}
    }
    @Test public void cookieJarIsProcessOnlyAndIsDestroyedWhenTheConfirmedServerIsClosed() throws Exception {
        File root=directory("keepany-connection-cookie");AtomicReference<CookieJar> captured=new AtomicReference<>();
        try(ConnectionsHttp http=fake(root,captured,200,new byte[]{1,2})) {
            String session=http.openSession("https://example.test");
            http.sessionRequest(id(),session,"https://example.test/api/auth/get-session","GET",Collections.emptyMap(),new byte[0]);
            HttpUrl url=HttpUrl.get("https://example.test/");Cookie cookie=new Cookie.Builder().name("session").value("synthetic").hostOnlyDomain("example.test").httpOnly().secure().path("/").build();
            CookieJar first=captured.get();first.saveFromResponse(url,Collections.singletonList(cookie));assertEquals(1,first.loadForRequest(url).size());
            http.closeSession(session);assertTrue(first.loadForRequest(url).isEmpty());
            String next=http.openSession("https://example.test");assertNotEquals(session,next);
            http.sessionRequest(id(),next,"https://example.test/api/auth/get-session","GET",Collections.emptyMap(),new byte[0]);assertTrue(captured.get().loadForRequest(url).isEmpty());
            assertEquals(0,Objects.requireNonNull(root.list()).length);
        }finally{root.delete();}
    }
    @Test public void backupCiphertextUsesBoundedFilesAndCannotGrowPastTheExistingBudgetOrReviveAfterCancel() throws Exception {
        File root=directory("keepany-connection-files");AtomicReference<CookieJar> captured=new AtomicReference<>();
        try(ConnectionsHttp http=fake(root,captured,200,new byte[]{0,(byte)128,(byte)255,64})) {
            String upload=id();byte[] chunk=new byte[ConnectionsHttp.CHUNK];for(int i=0;i<400;i++)http.backupWrite(upload,chunk);http.backupWrite(upload,new byte[1024]);
            try{http.backupWrite(upload,new byte[1]);fail();}catch(IOException expected){}
            http.backupRequest(upload,"https://backup.example.test/object.ka1?signature=synthetic","PUT",Collections.emptyMap());assertSame(CookieJar.NO_COOKIES,captured.get());
            try{http.backupWrite(upload,new byte[1]);fail();}catch(IOException expected){}
            http.cancel(upload);try{http.backupWrite(upload,new byte[1]);fail();}catch(IOException expected){}
            String download=id();ConnectionsHttp.Result result=http.backupRequest(download,"https://backup.example.test/object.ka1?signature=synthetic","GET",Collections.emptyMap());
            assertEquals(4,result.size);assertArrayEquals(new byte[]{0,(byte)128,(byte)255,64},http.backupRead(download,0));http.cancel(download);
            assertEquals(0,Objects.requireNonNull(root.list()).length);
        }finally{root.delete();}
    }
}
