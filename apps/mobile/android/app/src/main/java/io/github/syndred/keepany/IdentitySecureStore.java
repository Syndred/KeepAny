package io.github.syndred.keepany;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

public final class IdentitySecureStore {
    private static final Object LOCK = new Object();
    private static final int MAX_STATE = 256 * 1024;
    private final android.content.Context context;
    private final String namespace;
    public IdentitySecureStore(android.content.Context context) { this(context,"keepany-binding-v1"); }
    IdentitySecureStore(android.content.Context context,String namespace) {
        if(!namespace.matches("[A-Za-z0-9-]{1,80}")) throw new IllegalArgumentException();
        this.context=context.getApplicationContext();this.namespace=namespace;
    }
    private String prefix() {return context.getPackageName()+"."+namespace;}
    private AtomicFile file() {return new AtomicFile(new File(context.getNoBackupFilesDir(),namespace+".enc"));}
    private KeyStore keys() throws Exception { KeyStore result=KeyStore.getInstance("AndroidKeyStore"); result.load(null); return result; }
    private void createKeys() throws Exception {
        KeyPairGenerator pair=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");
        pair.initialize(new KeyGenParameterSpec.Builder(prefix()+".sign",KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build()); pair.generateKeyPair();
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(prefix()+".state",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build()); generator.generateKey();
    }
    private JSONObject readUnlocked() throws Exception {
        AtomicFile store=file();
        if(!store.getBaseFile().exists() && !new File(store.getBaseFile().getPath()+".bak").exists()) throw new IllegalStateException();
        if(store.getBaseFile().length()>MAX_STATE*3 || new File(store.getBaseFile().getPath()+".bak").length()>MAX_STATE*3) throw new IllegalStateException();
        byte[] bytes=store.readFully(); if(bytes.length>MAX_STATE*3) throw new IllegalStateException();
        JSONObject encrypted=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
        if(encrypted.getInt("v")!=1) throw new IllegalStateException();
        byte[] iv=Base64.decode(encrypted.getString("iv"),Base64.NO_WRAP), ciphertext=Base64.decode(encrypted.getString("ciphertext"),Base64.NO_WRAP);
        if(iv.length!=12 || ciphertext.length>MAX_STATE*2+4096) throw new IllegalStateException();
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,(SecretKey)keys().getKey(prefix()+".state",null),new GCMParameterSpec(128,iv)); cipher.updateAAD(prefix().getBytes(StandardCharsets.UTF_8));
        JSONObject result=new JSONObject(new String(cipher.doFinal(ciphertext),StandardCharsets.UTF_8));
        if(!result.getString("revision").matches("[0-9a-fA-F-]{36}") || result.getString("payload").getBytes(StandardCharsets.UTF_8).length>MAX_STATE) throw new IllegalStateException();
        return result;
    }
    private void writeUnlocked(JSONObject state) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,(SecretKey)keys().getKey(prefix()+".state",null)); cipher.updateAAD(prefix().getBytes(StandardCharsets.UTF_8));
        JSONObject envelope=new JSONObject(); envelope.put("v",1);envelope.put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP));envelope.put("ciphertext",Base64.encodeToString(cipher.doFinal(state.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));
        AtomicFile store=file(); FileOutputStream output=null;
        try { output=store.startWrite();output.write(envelope.toString().getBytes(StandardCharsets.UTF_8));output.getFD().sync();store.finishWrite(output); }
        catch(Exception failure) { if(output!=null) store.failWrite(output);throw failure; }
    }
    private String coordinate(BigInteger value) {
        byte[] encoded=value.toByteArray(), result=new byte[32]; int offset=encoded.length==33&&encoded[0]==0?1:0;
        if(encoded.length-offset>32) throw new IllegalArgumentException();System.arraycopy(encoded,offset,result,32-(encoded.length-offset),encoded.length-offset);
        return Base64.encodeToString(result,Base64.URL_SAFE|Base64.NO_PADDING|Base64.NO_WRAP);
    }

    public void initialize() throws Exception { synchronized(LOCK) {
        KeyStore store=keys();boolean exists=file().getBaseFile().exists()||new File(file().getBaseFile().getPath()+".bak").exists()||new File(file().getBaseFile().getPath()+".new").exists();
        if(!exists) {
            if(store.containsAlias(prefix()+".sign")||store.containsAlias(prefix()+".state")) throw new IllegalStateException();
            try {
                createKeys();JSONObject state=new JSONObject();state.put("revision",UUID.randomUUID().toString());state.put("payload","{\"bindings\":[],\"credentials\":[]}");writeUnlocked(state);
            } catch(Exception failure) {
                // Only this branch proved no old state or aliases existed before our attempt.
                // A valid committed envelope wins even if a later flush reported failure.
                boolean committed=false;try {readUnlocked();committed=true;}catch(Exception unreadable) { /* No readable commit from this fresh attempt. */ }
                if(!committed) { file().delete();KeyStore own=keys();own.deleteEntry(prefix()+".sign");own.deleteEntry(prefix()+".state"); }
                throw failure;
            }
        }
        if(!keys().containsAlias(prefix()+".sign")||!keys().containsAlias(prefix()+".state")) throw new IllegalStateException();
        readUnlocked();
    }}
    public JSONObject read() throws Exception { synchronized(LOCK) { return readUnlocked(); } }
    public boolean compareAndSet(String expected,String payload) throws Exception { synchronized(LOCK) {
        if(payload==null||payload.getBytes(StandardCharsets.UTF_8).length>MAX_STATE) throw new IllegalArgumentException();
        new JSONObject(payload);JSONObject current=readUnlocked();
        if(expected==null||!expected.equals(current.getString("revision"))) return false;
        JSONObject next=new JSONObject();next.put("revision",UUID.randomUUID().toString());next.put("payload",payload);writeUnlocked(next);return true;
    }}
    public JSONObject publicKey() throws Exception { synchronized(LOCK) {
        readUnlocked();ECPublicKey key=(ECPublicKey)keys().getCertificate(prefix()+".sign").getPublicKey();JSONObject result=new JSONObject();
        result.put("kty","EC");result.put("crv","P-256");result.put("x",coordinate(key.getW().getAffineX()));result.put("y",coordinate(key.getW().getAffineY()));return result;
    }}
    public byte[] sign(byte[] input) throws Exception { synchronized(LOCK) {
        if(input==null||input.length>8192||!new String(input,StandardCharsets.US_ASCII).matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")) throw new IllegalArgumentException();
        readUnlocked();Signature signer=Signature.getInstance("SHA256withECDSA");signer.initSign((java.security.PrivateKey)keys().getKey(prefix()+".sign",null));signer.update(input);return IdentitySignature.toJose(signer.sign());
    }}
}
