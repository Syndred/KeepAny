package io.github.syndred.keepany;

import static org.junit.Assert.*;
import java.io.IOException;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicReference;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLPeerUnverifiedException;
import org.junit.Test;
import org.junit.runner.RunWith;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import okhttp3.Call;
import okhttp3.EventListener;

/** Explicit public test URLs only; requires an online device, never user data. */
@RunWith(AndroidJUnit4.class)
public class MetadataDeviceTest {
    @Test public void productionTransportReadsPublicHtmlWithDefaultTls() throws Exception {
        MetadataFetcher.Result value = new MetadataFetcher().read("https://example.com/#discard", new MetadataFetcher.Budget(8000));
        assertEquals("https://example.com/", value.url);
        assertTrue(value.contentType.startsWith("text/html"));
        assertTrue(new String(value.bytes, StandardCharsets.UTF_8).contains("Example Domain"));
        assertTrue(value.bytes.length <= MetadataPolicy.MAX_BYTES);
    }

    @Test public void productionTransportRejectsLocalAndMappedTargets() throws Exception {
        for (String url : new String[] { "http://127.0.0.1/", "http://10.0.0.1/", "http://[::1]/", "https://[::ffff:8.8.8.8]/" }) {
            try { new MetadataFetcher().read(url, new MetadataFetcher.Budget(8000)); fail("accepted nonpublic target"); }
            catch (MetadataPolicy.Failure error) { assertEquals("metadata-private", error.code); }
        }
    }

    @Test public void defaultTlsRejectsWrongHostnameWithCertificateEvidence() throws Exception {
        AtomicReference<IOException> failure = new AtomicReference<>();
        MetadataFetcher fetcher = new MetadataFetcher(host -> Arrays.asList(InetAddress.getAllByName(host)), (url, address, remaining) ->
            MetadataFetcher.pinnedClient(url, address, remaining).newBuilder().eventListener(new EventListener() {
                @Override public void callFailed(Call call, IOException error) { failure.set(error); }
            }).build());
        try { fetcher.read("https://wrong.host.badssl.com/", new MetadataFetcher.Budget(8000)); fail("accepted invalid certificate"); }
        catch (MetadataPolicy.Failure error) { assertEquals("metadata-network", error.code); }
        // A generic DNS/connect failure is not evidence that TLS rejected it.
        Throwable cause = failure.get();
        while (cause != null && !(cause instanceof SSLPeerUnverifiedException) && !(cause instanceof SSLHandshakeException)) cause = cause.getCause();
        assertNotNull("requires observed TLS certificate/hostname failure", cause);
    }
}
