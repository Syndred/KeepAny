package io.github.syndred.keepany;

import static org.junit.Assert.*;
import java.net.InetAddress;
import java.net.Proxy;
import java.util.Collections;
import org.junit.Test;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;

public class MetadataPolicyTest {
    @Test public void originalAddressCorpusRejectsPrivateSpecialAndMappedAddresses() {
        String[] rejected = { "0.0.0.0", "10.1.2.3", "127.0.0.1", "100.64.0.1", "100.127.255.255", "169.254.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.0.1", "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:8.8.8.8", "64:ff9b::808:808", "2001::1", "2001:1ff::1", "2001:db8::1", "2002:808:808::1", "not-an-address", "1.2", "01.2.3.4", "256.2.3.4" };
        for (String address : rejected) assertFalse(address, MetadataPolicy.publicAddressText(address));
        for (String address : new String[] { "8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "192.0.1.1", "2001:200::1", "2001:4860:4860::8888", "2606:4700:4700::1111", "3fff::1" }) assertTrue(address, MetadataPolicy.publicAddressText(address));
    }

    @Test public void urlContractHasNoCredentialsOrAlternateSchemesAndRemovesFragment() throws Exception {
        assertEquals("https://example.com/page?q=1", MetadataPolicy.target("https://example.com/page?q=1#private").toString());
        for (String url : new String[] { "file:///etc/passwd", "ftp://example.com/a", "https://user:password@example.com/", "https://example.com/" + "a".repeat(2048), "" }) {
            try { MetadataPolicy.target(url); fail("accepted invalid URL"); } catch (MetadataPolicy.Failure error) { assertEquals("metadata-url", error.code); }
        }
    }

    @Test public void productionClientPinsOnlyValidatedAddressAndKeepsOriginalTlsAuthority() throws Exception {
        HttpUrl url = MetadataPolicy.target("https://example.com/");
        InetAddress address = InetAddress.getByName("8.8.8.8");
        OkHttpClient client = MetadataFetcher.pinnedClient(url, address, 8000);
        assertEquals(Collections.singletonList(address), client.dns().lookup("example.com"));
        assertEquals(Proxy.NO_PROXY, client.proxy());
        assertFalse(client.followRedirects()); assertFalse(client.followSslRedirects()); assertFalse(client.retryOnConnectionFailure());
        assertSame(new OkHttpClient().hostnameVerifier(), client.hostnameVerifier());
        assertEquals(8000, client.callTimeoutMillis());
        try { client.dns().lookup("other.example"); fail("accepted unrelated hostname"); } catch (java.net.UnknownHostException expected) { }
        client.connectionPool().evictAll();
    }

    @Test public void mappedLiteralsAreRejectedBeforeCanonicalizationIncludingRedirectAuthority() throws Exception {
        for (String url : new String[] { "https://[::ffff:8.8.8.8]/", "//[::ffff:808:808]/", "https:\\\\[::ffff:8.8.8.8]/", "https://[::ff\tff:8.8.8.8]/" }) {
            try { MetadataPolicy.validateRawAuthority(url); fail("accepted mapped authority"); }
            catch (MetadataPolicy.Failure expected) { assertEquals("metadata-private", expected.code); }
        }
    }
}
