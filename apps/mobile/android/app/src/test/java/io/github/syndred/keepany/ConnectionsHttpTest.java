package io.github.syndred.keepany;
import static org.junit.Assert.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.*;
import org.junit.Test;

public class ConnectionsHttpTest {
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
