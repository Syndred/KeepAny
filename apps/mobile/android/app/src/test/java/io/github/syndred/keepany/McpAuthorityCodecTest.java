package io.github.syndred.keepany;

import static org.junit.Assert.*;
import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import org.json.*;
import org.junit.Test;

/** JCE + real private temporary ciphertext files. Key vault/atomic IO are test doubles, not Android N. */
public class McpAuthorityCodecTest {
    private static final String A=String.join("",Collections.nCopies(64,"a")), B=String.join("",Collections.nCopies(64,"b"));
    private static final String GRANT=UUID.randomUUID().toString(), ASSET=UUID.randomUUID().toString(), PREVIEW=UUID.randomUUID().toString();
    private interface Checked {void run() throws Exception;}
    private static void reject(Checked action) throws Exception {try{action.run();fail("invalid metadata must fail closed");}catch(Exception expected){}}
    private static SecretKey key() throws Exception {KeyGenerator generator=KeyGenerator.getInstance("AES");generator.init(256);return generator.generateKey();}
    private static JSONObject metadata() throws Exception {
        JSONObject state=new JSONObject(McpAuthorityCodec.EMPTY);
        JSONObject grant=new JSONObject().put("id",GRANT).put("secretHash",A).put("assetIds",new JSONArray().put(ASSET)).put("readFields",new JSONArray().put("name")).put("writeFields",new JSONArray().put("name")).put("createdAt",1).put("expiresAt",60001);
        state.getJSONArray("grants").put(grant);
        JSONObject preview=new JSONObject().put("id",PREVIEW).put("grantId",GRANT).put("operationId","synthetic_operation").put("assetId",ASSET).put("expectedVersion",A).put("patchHash",B).put("expiresAt",300001).put("approvedAt",2);
        state.getJSONArray("previews").put(preview);
        state.getJSONArray("operations").put(new JSONObject().put("operationId","synthetic_operation").put("grantId",GRANT).put("previewId",PREVIEW).put("patchHash",B).put("assetId",ASSET).put("state","pending").put("createdAt",3));
        state.getJSONArray("audit").put(new JSONObject().put("id",UUID.randomUUID().toString()).put("at",2).put("grantId",GRANT).put("action","approve").put("outcome","allowed").put("assetId",ASSET).put("fieldNames",new JSONArray().put("name")));
        return state;
    }
    private static final class Disk implements McpAuthoritySecureStore.Backend,AutoCloseable {
        final Path root=Files.createTempDirectory("keepany-mcp-authority-");
        final Map<String,SecretKey> keys=new HashMap<>();int discarded=0;boolean failWrite,loseAcknowledgement;
        Disk() throws Exception {}
        Path file(String scope){return root.resolve(scope+".enc");}
        public boolean hasFile(String scope){return Files.exists(file(scope));}
        public boolean hasKey(String scope){return keys.containsKey(scope);}
        public SecretKey key(String scope) throws Exception {SecretKey key=keys.get(scope);if(key==null)throw new IOException("synthetic key missing");return key;}
        public void createKey(String scope) throws Exception {if(hasKey(scope))throw new IOException();keys.put(scope,McpAuthorityCodecTest.key());}
        public byte[] read(String scope) throws Exception {return Files.readAllBytes(file(scope));}
        public void commit(String scope,byte[] bytes) throws Exception {
            if(failWrite)throw new IOException("synthetic write failure");Path temporary=root.resolve(scope+".new");
            try{Files.write(temporary,bytes);try(FileChannel channel=FileChannel.open(temporary,StandardOpenOption.WRITE)){channel.force(true);}Files.move(temporary,file(scope),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}finally{Files.deleteIfExists(temporary);}
            if(loseAcknowledgement)throw new IOException("synthetic acknowledgement lost");
        }
        public void discardFresh(String scope) throws Exception {discarded++;Files.deleteIfExists(file(scope));keys.remove(scope);}
        public void close() throws Exception {try(DirectoryStream<Path> children=Files.newDirectoryStream(root)){for(Path child:children)Files.delete(child);}Files.delete(root);keys.clear();}
    }
    @Test public void usesExecutablePinnedJsonAndRoundTripsOnlyApprovedMetadata() throws Exception {
        assertTrue(JSONObject.class.getProtectionDomain().getCodeSource().getLocation().toString().contains("json-20250517"));
        SecretKey key=key();McpAuthorityCodec.Snapshot state=McpAuthorityCodec.snapshot(UUID.randomUUID().toString(),metadata().toString());
        byte[] first=McpAuthorityCodec.seal(A,state,key),second=McpAuthorityCodec.seal(A,state,key);
        assertFalse("random GCM nonces",Arrays.equals(first,second));assertFalse("no plaintext payload in ciphertext",new String(first,StandardCharsets.ISO_8859_1).contains(state.payload));
        McpAuthorityCodec.Snapshot read=McpAuthorityCodec.open(A,first,key);assertEquals(state.revision,read.revision);assertEquals(GRANT,new JSONObject(read.payload).getJSONArray("grants").getJSONObject(0).getString("id"));
        JSONObject completed=metadata();completed.getJSONArray("operations").getJSONObject(0).put("state","applied").put("completedAt",4);completed.put("previews",new JSONArray());completed.getJSONArray("grants").getJSONObject(0).put("revokedAt",5);
        assertEquals("applied",new JSONObject(McpAuthorityCodec.snapshot(state.revision,completed.toString()).payload).getJSONArray("operations").getJSONObject(0).getString("state"));
    }
    @Test public void rejectsUnknownRawSecretsFieldValuesDuplicateIdsAndInvalidTypedMetadata() throws Exception {
        List<JSONObject> invalid=new ArrayList<>();invalid.add(metadata().put("secret","never persist"));
        JSONObject grant=metadata();grant.getJSONArray("grants").getJSONObject(0).put("secret","never persist");invalid.add(grant);
        JSONObject preview=metadata();preview.getJSONArray("previews").getJSONObject(0).put("changes",new JSONArray().put(new JSONObject().put("before","private")));invalid.add(preview);
        JSONObject audit=metadata();audit.getJSONArray("audit").getJSONObject(0).put("fieldNames",new JSONArray().put("password"));invalid.add(audit);
        JSONObject timestamp=metadata();timestamp.getJSONArray("grants").getJSONObject(0).put("createdAt",true);invalid.add(timestamp);
        JSONObject completion=metadata();completion.getJSONArray("operations").getJSONObject(0).put("state","applied");invalid.add(completion);
        JSONObject duplicate=metadata();duplicate.getJSONArray("audit").put(duplicate.getJSONArray("audit").getJSONObject(0));invalid.add(duplicate);
        JSONObject both=metadata();both.getJSONArray("previews").getJSONObject(0).put("rejectedAt",3);invalid.add(both);
        for(JSONObject state:invalid)reject(()->McpAuthorityCodec.state(state.toString()));
        reject(()->McpAuthorityCodec.state(McpAuthorityCodec.EMPTY+"{}"));
        reject(()->McpAuthorityCodec.state("{\"grants\":"+String.join("",Collections.nCopies(9,"["))+"0"+String.join("",Collections.nCopies(9,"]"))+"}"));
        reject(()->McpAuthorityCodec.state(String.join("",Collections.nCopies(McpAuthorityCodec.MAX_STATE/3+1,"界"))));
    }
    @Test public void tamperingWrongKeyWrongScopeAndBadFramingNeverBecomeEmptyState() throws Exception {
        SecretKey key=key();McpAuthorityCodec.Snapshot state=McpAuthorityCodec.snapshot(UUID.randomUUID().toString(),McpAuthorityCodec.EMPTY);byte[] encrypted=McpAuthorityCodec.seal(A,state,key);
        reject(()->McpAuthorityCodec.open(B,encrypted,key));reject(()->McpAuthorityCodec.open(A,encrypted,key()));
        byte[] corrupt=encrypted.clone();corrupt[corrupt.length-1]^=1;reject(()->McpAuthorityCodec.open(A,corrupt,key));
        byte[] badVersion=encrypted.clone();badVersion[3]='2';reject(()->McpAuthorityCodec.open(A,badVersion,key));reject(()->McpAuthorityCodec.open(A,new byte[31],key));reject(()->McpAuthorityCodec.scope("../escape"));
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(("KeepAny/MCP/authority/v1/"+A).getBytes(StandardCharsets.UTF_8));byte[] invalid=cipher.doFinal(new byte[]{(byte)0xc0,(byte)0x80});
        byte[] frame=new byte[16+invalid.length];System.arraycopy(new byte[]{'K','M','A','1'},0,frame,0,4);System.arraycopy(cipher.getIV(),0,frame,4,12);System.arraycopy(invalid,0,frame,16,invalid.length);reject(()->McpAuthorityCodec.open(A,frame,key));
    }
    @Test public void newScopesAreEmptyAndReopenedInstancesReadTheSameEncryptedFileAndRevision() throws Exception {
        try(Disk disk=new Disk()){
            McpAuthoritySecureStore first=new McpAuthoritySecureStore(disk);first.initialize(A);McpAuthorityCodec.Snapshot empty=first.read(A);assertEquals(4,new JSONObject(empty.payload).length());
            assertTrue(first.compareAndSet(A,empty.revision,metadata().toString()));McpAuthoritySecureStore reopened=new McpAuthoritySecureStore(disk);reopened.initialize(A);McpAuthorityCodec.Snapshot read=reopened.read(A);assertEquals(1,new JSONObject(read.payload).getJSONArray("grants").length());assertNotEquals(empty.revision,read.revision);
            reopened.initialize(B);assertEquals(0,new JSONObject(reopened.read(B).payload).getJSONArray("grants").length());assertNotEquals(disk.key(A),disk.key(B));try(java.util.stream.Stream<Path> children=Files.list(disk.root)){assertEquals(2,children.count());}
        }
    }
    @Test public void partialMissingOrCorruptStateFailsClosedWithoutDeletingExistingStateOrKeys() throws Exception {
        try(Disk disk=new Disk()){
            McpAuthoritySecureStore store=new McpAuthoritySecureStore(disk);disk.createKey(A);reject(()->store.initialize(A));assertTrue(disk.hasKey(A));assertFalse(disk.hasFile(A));assertEquals(0,disk.discarded);
            disk.keys.remove(A);store.initialize(A);byte[] original=disk.read(A);SecretKey key=disk.keys.remove(A);reject(()->store.initialize(A));assertArrayEquals(original,disk.read(A));assertEquals(0,disk.discarded);
            disk.keys.put(A,key);byte[] corrupted=original.clone();corrupted[corrupted.length-1]^=1;Files.write(disk.file(A),corrupted);reject(()->store.initialize(A));assertArrayEquals(corrupted,disk.read(A));assertEquals(0,disk.discarded);
            Files.write(disk.file(A),original);store.initialize(A);assertEquals(4,new JSONObject(store.read(A).payload).length());
        }
    }
    @Test public void twoInstancesRaceOneRevisionAndExactlyOneCommitWins() throws Exception {
        try(Disk disk=new Disk()){
            McpAuthoritySecureStore first=new McpAuthoritySecureStore(disk),second=new McpAuthoritySecureStore(disk);first.initialize(A);String revision=first.read(A).revision;ExecutorService workers=Executors.newFixedThreadPool(2);
            try{CountDownLatch start=new CountDownLatch(1);Callable<Boolean> left=()->{start.await();return first.compareAndSet(A,revision,metadata().toString());},right=()->{start.await();return second.compareAndSet(A,revision,metadata().toString());};Future<Boolean> a=workers.submit(left),b=workers.submit(right);start.countDown();assertNotEquals(a.get(5,TimeUnit.SECONDS),b.get(5,TimeUnit.SECONDS));assertEquals(1,new JSONObject(first.read(A).payload).getJSONArray("operations").length());}
            finally{workers.shutdownNow();assertTrue(workers.awaitTermination(2,TimeUnit.SECONDS));}
        }
    }
    @Test public void failedWritesPreserveTheOldStateAndLostAcknowledgementsDoNotPermitStaleReplay() throws Exception {
        try(Disk disk=new Disk()){
            McpAuthoritySecureStore store=new McpAuthoritySecureStore(disk);store.initialize(A);McpAuthorityCodec.Snapshot old=store.read(A);byte[] ciphertext=disk.read(A);
            disk.failWrite=true;reject(()->store.compareAndSet(A,old.revision,metadata().toString()));assertArrayEquals(ciphertext,disk.read(A));assertEquals(old.revision,store.read(A).revision);assertEquals(0,disk.discarded);
            disk.failWrite=false;disk.loseAcknowledgement=true;reject(()->store.compareAndSet(A,old.revision,metadata().toString()));disk.loseAcknowledgement=false;
            McpAuthorityCodec.Snapshot committed=store.read(A);assertNotEquals(old.revision,committed.revision);assertFalse(store.compareAndSet(A,old.revision,McpAuthorityCodec.EMPTY));assertEquals(committed.revision,store.read(A).revision);
        }
    }
    @Test public void failedFreshCreationCanRetryButAReadableFreshCommitIsNeverDiscarded() throws Exception {
        try(Disk disk=new Disk()){
            McpAuthoritySecureStore store=new McpAuthoritySecureStore(disk);disk.failWrite=true;reject(()->store.initialize(A));assertFalse(disk.hasKey(A));assertFalse(disk.hasFile(A));assertEquals(1,disk.discarded);
            disk.failWrite=false;disk.loseAcknowledgement=true;reject(()->store.initialize(A));assertTrue(disk.hasKey(A));assertTrue(disk.hasFile(A));String revision=store.read(A).revision;assertEquals(1,disk.discarded);
            disk.loseAcknowledgement=false;store.initialize(A);assertEquals(revision,store.read(A).revision);
        }
    }
}
