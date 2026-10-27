package io.github.syndred.keepany;
import org.junit.Test;
import static org.junit.Assert.*;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
public final class IdentitySignatureTest {
 @Test public void convertsRealP256DerToJoseAndRejectsMalformedIntegers() throws Exception {
  KeyPairGenerator generator=KeyPairGenerator.getInstance("EC");generator.initialize(new ECGenParameterSpec("secp256r1"));KeyPair pair=generator.generateKeyPair();
  for(int index=0;index<24;index++) {
   byte[] message=("fixture-"+index).getBytes(java.nio.charset.StandardCharsets.UTF_8);
   Signature signer=Signature.getInstance("SHA256withECDSA");signer.initSign(pair.getPrivate());signer.update(message);
   byte[] raw=IdentitySignature.toJose(signer.sign());assertEquals(64,raw.length);
   Signature verifier=Signature.getInstance("SHA256withECDSAinP1363Format");verifier.initVerify(pair.getPublic());verifier.update(message);assertTrue(verifier.verify(raw));
  }
  byte[][] malformed={new byte[0],{0x30,6,2,1,(byte)0x80,2,1,1},{0x30,7,2,2,0,1,2,1,1},{0x30,6,2,1,1,2,1,1,0}};
  for(byte[] value:malformed) {try {IdentitySignature.toJose(value);fail("Malformed signature accepted");}catch(IllegalArgumentException expected) {assertEquals("identity-signature",expected.getMessage());}}
 }
}
