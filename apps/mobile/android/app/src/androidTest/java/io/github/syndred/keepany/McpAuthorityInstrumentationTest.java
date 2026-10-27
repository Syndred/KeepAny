package io.github.syndred.keepany;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContextWrapper;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.system.Os;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;

/** Real OS store tests. Only random scopes and one owned no-backup test directory are touched. */
@RunWith(AndroidJUnit4.class)
public final class McpAuthorityInstrumentationTest {
    private Context context;
    private File ownedDirectory;
    private final Set<String> scopes=new LinkedHashSet<>();
    private ExecutorService racers;
    private interface Throwing {void run() throws Exception;}

    @Before public void isolate() throws Exception {
        Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();
        File realNoBackup=target.getNoBackupFilesDir().getCanonicalFile();
        ownedDirectory=new File(realNoBackup,"mcp-authority-instrumentation-"+UUID.randomUUID());
        assertTrue("create unique owned test directory",ownedDirectory.mkdir());
        assertTrue("owned test directory remains under real no-backup",ownedDirectory.getCanonicalPath().startsWith(realNoBackup.getPath()+File.separator));
        // The production constructor calls getApplicationContext(): retain this exact wrapper.
        context=new ContextWrapper(target){
            @Override public Context getApplicationContext(){return this;}
            @Override public File getNoBackupFilesDir(){return ownedDirectory;}
        };
    }
    @After public void cleanupOnlyOwned() throws Exception {
        try{if(racers!=null){racers.shutdownNow();assertTrue("test CAS workers stop",racers.awaitTermination(30,TimeUnit.SECONDS));}}
        finally{try{if(context!=null){KeyStore keys=keys();for(String scope:scopes){keys.deleteEntry(alias(scope));assertFalse("owned alias removed",keys.containsAlias(alias(scope)));}}}
            finally{if(ownedDirectory!=null&&ownedDirectory.exists())deleteOwned(ownedDirectory);if(ownedDirectory!=null)assertFalse("owned test directory removed",ownedDirectory.exists());}}
    }
    private void deleteOwned(File file) throws Exception {
        String root=ownedDirectory.getCanonicalPath(),path=file.getCanonicalPath();
        assertTrue("cleanup is confined to this test directory",path.equals(root)||path.startsWith(root+File.separator));
        if(file.isDirectory()){File[] children=file.listFiles();assertNotNull("read owned test directory",children);for(File child:children)deleteOwned(child);}
        assertTrue("remove only owned test path",file.delete());
    }
    private String scope() throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(UUID.randomUUID().toString().getBytes(StandardCharsets.UTF_8));StringBuilder value=new StringBuilder();for(byte part:digest)value.append(String.format(Locale.ROOT,"%02x",part&255));
        String scope=value.toString();assertTrue("unique random scope",scopes.add(scope));return scope;
    }
    private String alias(String scope){assertTrue("only registered random scope",scopes.contains(scope));return context.getPackageName()+".mcp-authority.v1."+scope;}
    private KeyStore keys() throws Exception {KeyStore result=KeyStore.getInstance("AndroidKeyStore");result.load(null);return result;}
    private SecretKey key(String scope) throws Exception {Object value=keys().getKey(alias(scope),null);assertTrue("OS secret key reference",value instanceof SecretKey);return (SecretKey)value;}
    private File root(){return new File(ownedDirectory,"keepany-mcp-authority-v1");}
    private File file(String scope){assertTrue("file belongs to random test scope",scopes.contains(scope));return new File(root(),scope+".enc");}
    private byte[] bytes(File file) throws Exception {
        try(FileInputStream input=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] block=new byte[8192];for(int count;(count=input.read(block))!=-1;)out.write(block,0,count);return out.toByteArray();}
    }
    private byte[] hash(File file) throws Exception {return MessageDigest.getInstance("SHA-256").digest(bytes(file));}
    private void overwrite(File file,byte[] value) throws Exception {try(FileOutputStream output=new FileOutputStream(file)){output.write(value);output.getFD().sync();}}
    private void fails(Throwing action) throws Exception {boolean rejected=false;try{action.run();}catch(Exception expected){rejected=true;}assertTrue("operation must fail closed",rejected);}
    private void same(byte[] left,byte[] right){assertTrue("owned ciphertext hash/bytes unchanged",MessageDigest.isEqual(left,right));}
    private void empty(McpAuthorityCodec.Snapshot snapshot) throws Exception {
        JSONObject state=new JSONObject(snapshot.payload);assertEquals("fresh state has exactly four metadata arrays",4,state.length());
        for(String name:new String[]{"grants","previews","operations","audit"})assertEquals("fresh metadata array empty",0,state.getJSONArray(name).length());
    }
    private String payload(String asset) throws Exception {
        String grantId=UUID.randomUUID().toString(),previewId=UUID.randomUUID().toString();long now=System.currentTimeMillis();
        JSONObject grant=new JSONObject().put("id",grantId).put("secretHash",scopeHash(asset)).put("assetIds",new JSONArray().put(asset)).put("readFields",new JSONArray().put("name").put("url")).put("writeFields",new JSONArray().put("name")).put("createdAt",now).put("expiresAt",now+120000);
        JSONObject preview=new JSONObject().put("id",previewId).put("grantId",grantId).put("operationId","synthetic_operation_01").put("assetId",asset).put("expectedVersion",scopeHash("expected"+asset)).put("patchHash",scopeHash("patch"+asset)).put("expiresAt",now+60000);
        JSONObject receipt=new JSONObject().put("operationId","synthetic_operation_01").put("grantId",grantId).put("previewId",previewId).put("patchHash",scopeHash("patch"+asset)).put("assetId",asset).put("state","pending").put("createdAt",now);
        JSONObject audit=new JSONObject().put("id",UUID.randomUUID().toString()).put("at",now).put("grantId",grantId).put("action","preview").put("outcome","allowed").put("assetId",asset).put("fieldNames",new JSONArray().put("name"));
        return new JSONObject().put("grants",new JSONArray().put(grant)).put("previews",new JSONArray().put(preview)).put("operations",new JSONArray().put(receipt)).put("audit",new JSONArray().put(audit)).toString();
    }
    private String scopeHash(String text) throws Exception {StringBuilder value=new StringBuilder();for(byte part:MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))value.append(String.format(Locale.ROOT,"%02x",part&255));return value.toString();}
    private boolean contains(byte[] bytes,String marker){byte[] target=marker.getBytes(StandardCharsets.UTF_8);outer:for(int i=0;i<=bytes.length-target.length;i++){for(int j=0;j<target.length;j++)if(bytes[i+j]!=target[j])continue outer;return true;}return false;}

    @Test public void realKeyStoreNoBackupPermissionsAndReopen() throws Exception {
        String scope=scope(),asset="asset_synthetic_"+UUID.randomUUID().toString().replace("-","");McpAuthoritySecureStore store=new McpAuthoritySecureStore(context);store.initialize(scope);empty(store.read(scope));
        SecretKey key=key(scope);assertNull("key material cannot be exported",key.getEncoded());assertNull("nonexportable key has no encoding format",key.getFormat());
        KeyInfo info=(KeyInfo)SecretKeyFactory.getInstance("AES","AndroidKeyStore").getKeySpec(key,KeyInfo.class);
        assertEquals("AES key size",256,info.getKeySize());assertEquals("generated in AndroidKeyStore",KeyProperties.ORIGIN_GENERATED,info.getOrigin());assertEquals("only encrypt/decrypt purposes",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT,info.getPurposes());assertTrue("GCM only",Arrays.equals(new String[]{KeyProperties.BLOCK_MODE_GCM},info.getBlockModes()));assertTrue("no encryption padding",Arrays.equals(new String[]{KeyProperties.ENCRYPTION_PADDING_NONE},info.getEncryptionPaddings()));
        assertTrue("root is inside this real no-backup test directory",root().getCanonicalPath().startsWith(ownedDirectory.getCanonicalPath()+File.separator));assertEquals("authority directory owner-only",0700,Os.stat(root().getPath()).st_mode&0777);assertEquals("ciphertext not group/world accessible",0,Os.stat(file(scope).getPath()).st_mode&0077);
        McpAuthorityCodec.Snapshot before=store.read(scope);String intended=payload(asset);assertTrue("real encrypted commit acknowledged",store.compareAndSet(scope,before.revision,intended));
        McpAuthoritySecureStore reopened=new McpAuthoritySecureStore(context);reopened.initialize(scope);McpAuthorityCodec.Snapshot loaded=reopened.read(scope);assertFalse("commit changes revision",before.revision.equals(loaded.revision));assertTrue("metadata roundtrip",new JSONObject(intended).toString().equals(new JSONObject(loaded.payload).toString()));
        byte[] ciphertext=bytes(file(scope));assertFalse("asset id is not persisted as plaintext",contains(ciphertext,asset));assertFalse("grant hash field is encrypted",contains(ciphertext,"secretHash"));assertTrue("fresh initialization is idempotent",loaded.revision.equals(new McpAuthoritySecureStore(context).read(scope).revision));
    }
    @Test public void twoRealInstancesCasRaceAndScopeIsolation() throws Exception {
        String scope=scope(),other=scope();McpAuthoritySecureStore one=new McpAuthoritySecureStore(context),two=new McpAuthoritySecureStore(context);one.initialize(scope);two.initialize(other);String revision=one.read(scope).revision;byte[] otherHash=hash(file(other));String left=payload("asset_synthetic_left"),right=payload("asset_synthetic_right");
        racers=Executors.newFixedThreadPool(2);CountDownLatch ready=new CountDownLatch(2),go=new CountDownLatch(1);
        Future<Boolean> a=racers.submit(()->{ready.countDown();assertTrue(go.await(10,TimeUnit.SECONDS));return one.compareAndSet(scope,revision,left);});
        Future<Boolean> b=racers.submit(()->{ready.countDown();assertTrue(go.await(10,TimeUnit.SECONDS));return two.compareAndSet(scope,revision,right);});
        assertTrue("two independent instances ready",ready.await(10,TimeUnit.SECONDS));go.countDown();boolean first=a.get(30,TimeUnit.SECONDS),second=b.get(30,TimeUnit.SECONDS);assertTrue("exactly one CAS wins",first!=second);
        McpAuthorityCodec.Snapshot actual=new McpAuthoritySecureStore(context).read(scope);assertTrue("winning metadata retained",actual.payload.equals(new JSONObject(first?left:right).toString()));assertFalse("old revision refuses retry",two.compareAndSet(scope,revision,payload("asset_synthetic_stale")));same(otherHash,hash(file(other)));empty(two.read(other));
    }
    @Test public void wrongScopeAndTamperedCiphertextCannotResetAuthority() throws Exception {
        String a=scope(),b=scope();McpAuthoritySecureStore store=new McpAuthoritySecureStore(context);store.initialize(a);store.initialize(b);byte[] originalA=bytes(file(a)),originalB=bytes(file(b));
        fails(()->McpAuthorityCodec.open(b,originalA,key(a)));overwrite(file(b),originalA);fails(()->store.read(b));fails(()->store.initialize(b));same(originalA,bytes(file(b)));same(originalA,bytes(file(a)));
        overwrite(file(b),originalB);byte[] changed=originalA.clone();changed[changed.length-1]^=1;overwrite(file(a),changed);fails(()->store.read(a));fails(()->store.initialize(a));same(changed,bytes(file(a)));
        overwrite(file(a),originalA);empty(new McpAuthoritySecureStore(context).read(a));empty(new McpAuthoritySecureStore(context).read(b));
    }
    @Test public void missingKeyOrMissingFileFailsClosedAndKeepsOtherHalf() throws Exception {
        String missingKey=scope(),missingFile=scope();McpAuthoritySecureStore store=new McpAuthoritySecureStore(context);store.initialize(missingKey);store.initialize(missingFile);byte[] retained=hash(file(missingKey));
        keys().deleteEntry(alias(missingKey));fails(()->store.read(missingKey));fails(()->store.initialize(missingKey));same(retained,hash(file(missingKey)));assertFalse("missing key not silently regenerated",keys().containsAlias(alias(missingKey)));
        assertTrue("remove only owned scope ciphertext",file(missingFile).delete());fails(()->store.read(missingFile));fails(()->store.initialize(missingFile));assertTrue("remaining OS key retained",keys().containsAlias(alias(missingFile)));assertFalse("missing file not silently recreated",file(missingFile).exists());
    }
    @Test public void realAtomicFileWriteFailureKeepsCommittedRevisionAndCanRetry() throws Exception {
        String scope=scope();McpAuthoritySecureStore store=new McpAuthoritySecureStore(context);store.initialize(scope);McpAuthorityCodec.Snapshot old=store.read(scope);byte[] committed=hash(file(scope));
        File blocked=new File(root(),scope+".enc.new"),marker=new File(blocked,"owned-test-blocker");assertTrue("create owned AtomicFile blocker",blocked.mkdir());overwrite(marker,new byte[]{1});
        try{fails(()->store.compareAndSet(scope,old.revision,payload("asset_synthetic_failed")));same(committed,hash(file(scope)));}
        finally{assertTrue("remove only owned blocker",marker.delete());assertTrue("remove only owned blocker directory",blocked.delete());}
        McpAuthorityCodec.Snapshot read=new McpAuthoritySecureStore(context).read(scope);assertTrue("old committed revision preserved",old.revision.equals(read.revision));assertTrue("old metadata preserved",old.payload.equals(read.payload));assertTrue("retry commits safely",store.compareAndSet(scope,old.revision,payload("asset_synthetic_retry")));
    }
    @Test public void platformJsonRejectsUnknownRawSecretAndFieldValueMetadata() throws Exception {
        String scope=scope();McpAuthoritySecureStore store=new McpAuthoritySecureStore(context);store.initialize(scope);McpAuthorityCodec.Snapshot before=store.read(scope);byte[] original=hash(file(scope));
        JSONObject unknown=new JSONObject(McpAuthorityCodec.EMPTY).put("fieldValues",new JSONObject().put("name","synthetic_unallowed"));fails(()->store.compareAndSet(scope,before.revision,unknown.toString()));
        JSONObject raw=new JSONObject(payload("asset_synthetic_schema"));raw.getJSONArray("grants").getJSONObject(0).put("secret","synthetic_unallowed");fails(()->store.compareAndSet(scope,before.revision,raw.toString()));same(original,hash(file(scope)));assertTrue("schema rejection keeps revision",before.revision.equals(store.read(scope).revision));
    }
}
