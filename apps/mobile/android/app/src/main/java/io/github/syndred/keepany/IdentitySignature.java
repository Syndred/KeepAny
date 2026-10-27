package io.github.syndred.keepany;

/** Strict ASN.1 ECDSA encoding conversion; signing remains AndroidKeyStore's responsibility. */
public final class IdentitySignature {
    private IdentitySignature() {}
    public static byte[] toJose(byte[] der) {
        if (der == null || der.length < 8 || der.length > 72 || der[0] != 0x30 || (der[1] & 255) != der.length - 2) throw new IllegalArgumentException("identity-signature");
        byte[] out = new byte[64]; int cursor = integer(der, 2, out, 0); cursor = integer(der, cursor, out, 32);
        if (cursor != der.length) throw new IllegalArgumentException("identity-signature");
        return out;
    }
    private static int integer(byte[] der, int cursor, byte[] out, int target) {
        if (cursor + 2 > der.length || der[cursor++] != 2) throw new IllegalArgumentException("identity-signature");
        int size = der[cursor++] & 255;
        if (size < 1 || size > 33 || cursor + size > der.length || (der[cursor] & 128) != 0) throw new IllegalArgumentException("identity-signature");
        if (size > 1 && der[cursor] == 0) {
            if ((der[cursor + 1] & 128) == 0) throw new IllegalArgumentException("identity-signature");
            cursor++; size--;
        }
        if (size > 32) throw new IllegalArgumentException("identity-signature");
        System.arraycopy(der, cursor, out, target + 32 - size, size); return cursor + size;
    }
}
