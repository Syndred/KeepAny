package io.github.syndred.keepany;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.InetAddress;
import java.net.Proxy;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import okhttp3.Authenticator;
import okhttp3.Call;
import okhttp3.ConnectionPool;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

final class MetadataFetcher {
    interface Resolver { List<InetAddress> lookup(String hostname) throws IOException; }
    interface ClientFactory { OkHttpClient create(HttpUrl url, InetAddress address, long remainingMs); }
    static final Pattern HTML = Pattern.compile("^(?:text/html|application/xhtml\\+xml)(?:\\s*;|\\s*$)", Pattern.CASE_INSENSITIVE);
    private final Resolver resolver;
    private final ClientFactory clients;

    static final class Budget {
        private final long deadline;
        private final AtomicBoolean cancelled = new AtomicBoolean(false);
        private final AtomicReference<Call> active = new AtomicReference<>();
        Budget(long timeoutMs) { deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs); }
        long remainingMs() throws MetadataPolicy.Failure {
            long nanos = deadline - System.nanoTime();
            if (cancelled.get() || nanos <= 0) throw new MetadataPolicy.Failure("metadata-timeout");
            return Math.max(1, TimeUnit.NANOSECONDS.toMillis(nanos));
        }
        boolean expired() { return cancelled.get() || System.nanoTime() >= deadline; }
        void attach(Call call) { active.set(call); if (expired()) call.cancel(); }
        void detach(Call call) { active.compareAndSet(call, null); }
        void cancel() { cancelled.set(true); Call call = active.get(); if (call != null) call.cancel(); }
    }

    static final class Result {
        final String url, contentType;
        final byte[] bytes;
        Result(String url, String contentType, byte[] bytes) { this.url = url; this.contentType = contentType; this.bytes = bytes; }
    }

    MetadataFetcher() {
        this(host -> Arrays.asList(InetAddress.getAllByName(host)), MetadataFetcher::pinnedClient);
    }
    // Package-private seams isolate deterministic policy/transport tests. The
    // Capacitor bridge always constructs the fixed production implementation.
    MetadataFetcher(Resolver resolver, ClientFactory clients) { this.resolver = resolver; this.clients = clients; }

    static OkHttpClient pinnedClient(HttpUrl url, InetAddress address, long remainingMs) {
        return new OkHttpClient.Builder()
            .dns(host -> {
                if (!host.equals(url.host())) throw new java.net.UnknownHostException("metadata-network");
                return Collections.singletonList(address);
            })
            .proxy(Proxy.NO_PROXY).proxyAuthenticator(Authenticator.NONE).authenticator(Authenticator.NONE)
            .cookieJar(CookieJar.NO_COOKIES).cache(null)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .protocols(Collections.singletonList(Protocol.HTTP_1_1))
            .connectionPool(new ConnectionPool(0, 1, TimeUnit.NANOSECONDS))
            .callTimeout(remainingMs, TimeUnit.MILLISECONDS).connectTimeout(remainingMs, TimeUnit.MILLISECONDS)
            .readTimeout(remainingMs, TimeUnit.MILLISECONDS).writeTimeout(remainingMs, TimeUnit.MILLISECONDS).build();
    }

    Result read(String input, Budget budget) throws IOException {
        HttpUrl url = MetadataPolicy.target(input);
        try {
            for (int redirects = 0; redirects <= 4; redirects++) {
                budget.remainingMs();
                List<InetAddress> addresses = resolver.lookup(url.host());
                // A cancelled/timed-out DNS query keeps its coordinator slot
                // until lookup actually exits, and cannot start a connection.
                budget.remainingMs();
                if (addresses.isEmpty() || addresses.stream().anyMatch(address -> !MetadataPolicy.publicAddress(address)) ||
                    (url.host().contains(":") && !MetadataPolicy.publicAddressText(url.host()))) throw new MetadataPolicy.Failure("metadata-private");
                OkHttpClient client = clients.create(url, addresses.get(0), budget.remainingMs());
                Request request = new Request.Builder().url(url).get()
                    .header("Accept", "text/html, application/xhtml+xml").header("Accept-Encoding", "identity")
                    .header("User-Agent", "KeepAny-Metadata/1.0").build();
                Call call = client.newCall(request);
                budget.attach(call);
                try (Response response = call.execute()) {
                    budget.remainingMs();
                    int status = response.code();
                    if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                        List<String> locations = response.headers("Location");
                        String location = locations.isEmpty() ? null : locations.get(0);
                        if (redirects == 4 || location == null || location.isEmpty()) throw new MetadataPolicy.Failure("metadata-redirect");
                        MetadataPolicy.validateRawAuthority(location);
                        HttpUrl next = url.resolve(location);
                        if (next == null) throw new MetadataPolicy.Failure("metadata-redirect");
                        url = MetadataPolicy.target(next.toString());
                        continue;
                    }
                    if (status < 200 || status >= 300) throw new MetadataPolicy.Failure("metadata-http");
                    String type = response.header("Content-Type", "");
                    if (response.headers("Content-Type").size() != 1 || !HTML.matcher(type).find()) throw new MetadataPolicy.Failure("metadata-type");
                    String encoding = response.header("Content-Encoding"), length = response.header("Content-Length");
                    if (response.headers("Content-Encoding").size() > 1 || response.headers("Content-Length").size() > 1 ||
                        (encoding != null && !encoding.equals("identity"))) throw new MetadataPolicy.Failure("metadata-limit");
                    if (length != null) {
                        try {
                            if (!length.matches("[0-9]+") || Long.parseLong(length) > MetadataPolicy.MAX_BYTES) throw new MetadataPolicy.Failure("metadata-limit");
                        } catch (NumberFormatException error) { throw new MetadataPolicy.Failure("metadata-limit"); }
                    }
                    ResponseBody body = response.body();
                    if (body == null) throw new MetadataPolicy.Failure("metadata-network");
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    try (InputStream stream = body.byteStream()) {
                        byte[] buffer = new byte[8192];
                        int size;
                        while ((size = stream.read(buffer)) != -1) {
                            budget.remainingMs();
                            if (output.size() + size > MetadataPolicy.MAX_BYTES) throw new MetadataPolicy.Failure("metadata-limit");
                            output.write(buffer, 0, size);
                        }
                    }
                    budget.remainingMs();
                    return new Result(url.toString(), type, output.toByteArray());
                } finally { budget.detach(call); client.connectionPool().evictAll(); }
            }
        } catch (IOException error) {
            if (budget.expired() || error instanceof InterruptedIOException) throw new MetadataPolicy.Failure("metadata-timeout");
            if (error instanceof MetadataPolicy.Failure) throw error;
            throw new MetadataPolicy.Failure("metadata-network");
        }
        throw new MetadataPolicy.Failure("metadata-redirect");
    }
}
