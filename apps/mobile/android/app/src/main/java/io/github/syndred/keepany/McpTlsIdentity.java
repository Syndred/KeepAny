package io.github.syndred.keepany;

import io.netty.handler.ssl.*;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.*;
import javax.net.ssl.SSLContext;
import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.asn1.x509.*;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.jcajce.*;
import org.bouncycastle.operator.ContentSigner;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;

/** One explicitly started listener's in-memory identity. No provider registration or disk writes. */
final class McpTlsIdentity implements AutoCloseable {
    private PrivateKey privateKey;
    private X509Certificate certificate;
    final String certificatePem,spkiSha256;
    private McpTlsIdentity(PrivateKey key,X509Certificate certificate) throws Exception {
        this.privateKey=key;this.certificate=certificate;
        String encoded=androidSafeBase64(certificate.getEncoded());StringBuilder pem=new StringBuilder("-----BEGIN CERTIFICATE-----\n");
        for(int at=0;at<encoded.length();at+=64)pem.append(encoded,at,Math.min(encoded.length(),at+64)).append('\n');
        certificatePem=pem.append("-----END CERTIFICATE-----\n").toString();
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(certificate.getPublicKey().getEncoded());StringBuilder hex=new StringBuilder();for(byte value:digest)hex.append(String.format(Locale.ROOT,"%02x",value&255));spkiSha256=hex.toString();
    }
    // BC supplies a Java-8-compatible codec; java.util.Base64 is API26 on Android.
    private static String androidSafeBase64(byte[] value){return org.bouncycastle.util.encoders.Base64.toBase64String(value);}
    static McpTlsIdentity create(String address) throws Exception {
        McpHttpsServer.checkedAddress(address);
        KeyPairGenerator generator=KeyPairGenerator.getInstance("EC");generator.initialize(new ECGenParameterSpec("secp256r1"));KeyPair pair=generator.generateKeyPair();
        long now=System.currentTimeMillis();X500Name name=new X500Name("CN=KeepAny Local MCP");
        JcaX509v3CertificateBuilder builder=new JcaX509v3CertificateBuilder(name,new BigInteger(160,new SecureRandom()).abs().add(BigInteger.ONE),new Date(now-300000),new Date(now+12*60*60*1000),name,pair.getPublic());
        builder.addExtension(Extension.basicConstraints,true,new BasicConstraints(false));builder.addExtension(Extension.keyUsage,true,new KeyUsage(KeyUsage.digitalSignature));
        builder.addExtension(Extension.extendedKeyUsage,false,new ExtendedKeyUsage(KeyPurposeId.id_kp_serverAuth));builder.addExtension(Extension.subjectAlternativeName,false,new GeneralNames(new GeneralName(GeneralName.iPAddress,address)));
        ContentSigner signer=new JcaContentSignerBuilder("SHA256withECDSA").build(pair.getPrivate());X509CertificateHolder holder=builder.build(signer);
        X509Certificate certificate=new JcaX509CertificateConverter().getCertificate(holder);certificate.verify(pair.getPublic());return new McpTlsIdentity(pair.getPrivate(),certificate);
    }
    synchronized SslContext context() throws Exception {
        if(privateKey==null||certificate==null)throw new McpHttpsServer.Failure();
        List<String> protocols=new ArrayList<>();for(String protocol:SSLContext.getDefault().createSSLEngine().getSupportedProtocols())if(protocol.equals("TLSv1.2")||protocol.equals("TLSv1.3"))protocols.add(protocol);
        if(!protocols.contains("TLSv1.2"))throw new McpHttpsServer.Failure();
        return SslContextBuilder.forServer(privateKey,certificate).sslProvider(SslProvider.JDK).protocols(protocols)
            .ciphers(Arrays.asList("TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256","TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384","TLS_AES_128_GCM_SHA256","TLS_AES_256_GCM_SHA384","TLS_CHACHA20_POLY1305_SHA256"),SupportedCipherSuiteFilter.INSTANCE).build();
    }
    synchronized X509Certificate certificate(){return certificate;}
    public synchronized void close(){if(privateKey!=null)try{privateKey.destroy();}catch(Exception unsupported){/* Drop references even when the platform cannot physically erase copies. */}privateKey=null;certificate=null;}
}
