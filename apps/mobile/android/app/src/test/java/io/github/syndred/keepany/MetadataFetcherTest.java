package io.github.syndred.keepany;

import static org.junit.Assert.*;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import okhttp3.Interceptor;
import okhttp3.MediaType;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;

public class MetadataFetcherTest {
    private static InetAddress ip(String value) throws Exception { return InetAddress.getByName(value); }
    private static MetadataFetcher fake(MetadataFetcher.Resolver resolver, Interceptor interceptor) {
        return new MetadataFetcher(resolver, (url, address, remaining) -> MetadataFetcher.pinnedClient(url, address, remaining).newBuilder().addInterceptor(interceptor).build());
    }
    private static Response response(Interceptor.Chain chain, int status, String type, byte[] bytes) {
        return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("Synthetic")
            .header("Content-Type", type).body(ResponseBody.create(MediaType.get("application/octet-stream"), bytes)).build();
    }
    private static void failure(String code, MetadataFetcher fetcher) throws Exception {
        try { fetcher.read("https://example.com/start", new MetadataFetcher.Budget(8000)); fail("expected rejection"); }
        catch (MetadataPolicy.Failure error) { assertEquals(code, error.code); }
    }

    @Test public void rejectsAnyPrivateDnsAnswerBeforeOpeningTransport() throws Exception {
        InetAddress publicIp = ip("8.8.8.8"), privateIp = ip("127.0.0.1");
        AtomicInteger requests = new AtomicInteger();
        failure("metadata-private", fake(host -> Arrays.asList(publicIp, privateIp), chain -> { requests.incrementAndGet(); return response(chain, 200, "text/html", new byte[0]); }));
        assertEquals(0, requests.get());
    }

    @Test public void redirectsRevalidateAllDnsAnswersAndCannotReachPrivateTarget() throws Exception {
        InetAddress publicIp = ip("8.8.8.8"), privateIp = ip("10.0.0.1");
        AtomicInteger requests = new AtomicInteger();
        failure("metadata-private", fake(host -> Collections.singletonList(host.equals("example.com") ? publicIp : privateIp), chain -> {
            requests.incrementAndGet();
            return response(chain, 302, "text/html", new byte[0]).newBuilder().header("Location", "http://second.example/").build();
        }));
        assertEquals(1, requests.get());
    }

    @Test public void eachHopPinsFirstAddressWithFixedHeadersAndPreservesRawCharsetBytes() throws Exception {
        InetAddress first = ip("8.8.8.8"), second = ip("1.1.1.1");
        List<String> hosts = new ArrayList<>();
        AtomicInteger requests = new AtomicInteger();
        byte[] bytes = new byte[] { 60, 116, 105, 116, 108, 101, 62, (byte) 233 };
        MetadataFetcher fetcher = fake(host -> { hosts.add(host); return Arrays.asList(first, second); }, chain -> {
            assertEquals("identity", chain.request().header("Accept-Encoding"));
            assertEquals("KeepAny-Metadata/1.0", chain.request().header("User-Agent"));
            assertNull(chain.request().header("Cookie")); assertNull(chain.request().header("Authorization"));
            if (requests.getAndIncrement() == 0) return response(chain, 301, "text/html", new byte[0]).newBuilder().header("Location", "/final#removed").build();
            return response(chain, 200, "text/html; charset=windows-1252", bytes);
        });
        MetadataFetcher.Result result = fetcher.read("https://example.com/start#removed", new MetadataFetcher.Budget(8000));
        assertEquals("https://example.com/final", result.url); assertArrayEquals(bytes, result.bytes);
        assertEquals(Arrays.asList("example.com", "example.com"), hosts); assertEquals(2, requests.get());
    }

    @Test public void enforcesRedirectCountStatusMimeEncodingAndDeclaredAndActualBudgets() throws Exception {
        InetAddress address = ip("8.8.8.8");
        MetadataFetcher.Resolver resolver = host -> Collections.singletonList(address);
        AtomicInteger redirects = new AtomicInteger();
        failure("metadata-redirect", fake(resolver, chain -> { redirects.incrementAndGet(); return response(chain, 302, "text/html", new byte[0]).newBuilder().header("Location", "/again").build(); }));
        assertEquals(5, redirects.get());
        failure("metadata-http", fake(resolver, chain -> response(chain, 500, "text/html", new byte[0])));
        failure("metadata-type", fake(resolver, chain -> response(chain, 200, "application/json", new byte[0])));
        failure("metadata-limit", fake(resolver, chain -> response(chain, 200, "text/html", new byte[0]).newBuilder().header("Content-Encoding", "gzip").build()));
        failure("metadata-limit", fake(resolver, chain -> response(chain, 200, "text/html", new byte[0]).newBuilder().header("Content-Length", "1048577").build()));
        failure("metadata-limit", fake(resolver, chain -> response(chain, 200, "text/html", new byte[MetadataPolicy.MAX_BYTES + 1])));
    }

    @Test public void timedOutOrCancelledDnsKeepsAllFourProcessSlotsUntilLookupActuallyExits() throws Exception {
        CountDownLatch entered = new CountDownLatch(4), release = new CountDownLatch(1);
        InetAddress address = ip("8.8.8.8");
        AtomicInteger unexpectedTransport = new AtomicInteger();
        MetadataFetcher fetcher = fake(host -> {
            entered.countDown();
            boolean interrupted = false;
            for (;;) { try { release.await(); break; } catch (InterruptedException error) { interrupted = true; } }
            if (interrupted) Thread.currentThread().interrupt();
            return Collections.singletonList(address);
        }, chain -> { unexpectedTransport.incrementAndGet(); return response(chain, 200, "text/html", new byte[0]); });
        LinkedBlockingQueue<String> replies = new LinkedBlockingQueue<>();
        try (MetadataCoordinator coordinator = new MetadataCoordinator(fetcher, 150); MetadataCoordinator recreated = new MetadataCoordinator(fetcher, 150)) {
            for (int i = 0; i < 4; i++) coordinator.read("request-" + i, "https://example.com/", (result, error) -> replies.add(error == null ? "success" : error));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            coordinator.cancel("request-0");
            for (int i = 0; i < 4; i++) assertEquals("metadata-timeout", replies.poll(2, TimeUnit.SECONDS));
            assertEquals(4, coordinator.activeCount());
            coordinator.close();
            recreated.read("fifth", "https://example.com/", (result, error) -> replies.add(error));
            assertEquals("metadata-busy", replies.poll(1, TimeUnit.SECONDS));
            release.countDown();
            long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (coordinator.activeCount() > 0 && System.nanoTime() < until) Thread.sleep(5);
            assertEquals(0, coordinator.activeCount()); assertNull(replies.poll(50, TimeUnit.MILLISECONDS));
            assertEquals(0, unexpectedTransport.get());
        } finally { release.countDown(); }
    }
}
