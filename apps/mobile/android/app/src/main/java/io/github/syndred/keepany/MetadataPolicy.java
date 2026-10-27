package io.github.syndred.keepany;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import okhttp3.HttpUrl;

/** Mirrors scripts/intake-url-metadata.mjs; no caller supplied exceptions. */
final class MetadataPolicy {
    static final int MAX_BYTES = 1024 * 1024;
    static final int TIMEOUT_MS = 8000;
    static final int MAX_ACTIVE = 4;

    static final class Failure extends IOException {
        final String code;
        Failure(String code) { super(code); this.code = code; }
    }

    static HttpUrl target(String input) throws Failure {
        if (input == null || input.isEmpty() || input.length() > 2048) throw new Failure("metadata-url");
        HttpUrl url;
        try { url = HttpUrl.get(input); } catch (IllegalArgumentException error) { throw new Failure("metadata-url"); }
        if (!(url.scheme().equals("http") || url.scheme().equals("https")) || !url.username().isEmpty() || !url.password().isEmpty()) throw new Failure("metadata-url");
        validateRawAuthority(input);
        return url.newBuilder().fragment(null).build();
    }

    // Inspect before HttpUrl canonicalizes IPv4-mapped IPv6 into an IPv4 host.
    // WHATWG-style slash/control normalization also covers redirect locations.
    static void validateRawAuthority(String input) throws Failure {
        String normalized = input.replace('\\', '/').replace("\t", "").replace("\r", "").replace("\n", "").trim();
        java.util.regex.Matcher authority = java.util.regex.Pattern.compile("^(?:https?:)?//([^/?#]*)", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(normalized);
        if (authority.find()) {
            String rawHost = authority.group(1);
            if (rawHost.contains("@")) throw new Failure("metadata-url");
            if (rawHost.startsWith("[")) {
                int close = rawHost.indexOf(']');
                if (close < 0 || !publicAddressText(rawHost.substring(1, close))) throw new Failure("metadata-private");
            }
        }
    }

    static boolean publicAddress(InetAddress address) {
        byte[] raw = address.getAddress();
        if (address instanceof Inet4Address) {
            int a = raw[0] & 255, b = raw[1] & 255, c = raw[2] & 255;
            return !(a == 0 || a == 10 || a == 127 || a >= 224 ||
                (a == 100 && b >= 64 && b <= 127) || (a == 169 && b == 254) ||
                (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) ||
                (a == 192 && b == 0 && (c == 0 || c == 2)) || (a == 192 && b == 88 && c == 99) ||
                (a == 198 && (b == 18 || b == 19)) || (a == 198 && b == 51 && c == 100) ||
                (a == 203 && b == 0 && c == 113));
        }
        if (address instanceof Inet6Address) {
            int first = (raw[0] & 255) * 256 + (raw[1] & 255), second = (raw[2] & 255) * 256 + (raw[3] & 255);
            return first >= 0x2000 && first <= 0x3fff && first != 0x2002 &&
                !(first == 0x2001 && (second < 0x200 || second == 0xdb8));
        }
        return false;
    }

    static boolean publicAddressText(String text) {
        if (text == null || text.isEmpty()) return false;
        boolean ipv6 = text.contains(":");
        if (ipv6) {
            if (!text.matches("[0-9a-fA-F:.]+")) return false;
        } else {
            String[] parts = text.split("\\.", -1);
            if (parts.length != 4) return false;
            for (String part : parts) if (!part.matches("0|[1-9][0-9]{0,2}") || Integer.parseInt(part) > 255) return false;
        }
        try {
            InetAddress address = InetAddress.getByName(text);
            return (!ipv6 || address instanceof Inet6Address) && publicAddress(address);
        } catch (Exception error) { return false; }
    }
}
