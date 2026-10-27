package io.github.syndred.keepany;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.*;
import java.security.KeyStore;
import java.util.*;
import javax.crypto.*;

/** Separate no-backup authority namespace; keys and plaintext never leave the native store. */
public final class McpAuthoritySecureStore {
    private static final Object LOCK=new Object();
    interface Backend {
        boolean hasFile(String scope) throws Exception;
        boolean hasKey(String scope) throws Exception;
        SecretKey key(String scope) throws Exception;
        void createKey(String scope) throws Exception;
        byte[] read(String scope) throws Exception;
        void commit(String scope,byte[] ciphertext) throws Exception;
        void discardFresh(String scope) throws Exception;
    }
    private final Backend backend;
    public McpAuthoritySecureStore(Context context){this(new NativeBackend(context.getApplicationContext()));}
    McpAuthoritySecureStore(Backend backend){this.backend=backend;}
    private McpAuthorityCodec.Snapshot readUnlocked(String scope) throws Exception {
        McpAuthorityCodec.scope(scope);if(!backend.hasFile(scope)||!backend.hasKey(scope))throw new McpAuthorityCodec.Failure();
        return McpAuthorityCodec.open(scope,backend.read(scope),backend.key(scope));
    }
    public void initialize(String scope) throws Exception {synchronized(LOCK){
        McpAuthorityCodec.scope(scope);boolean file=backend.hasFile(scope),key=backend.hasKey(scope);
        if(file!=key)throw new McpAuthorityCodec.Failure();
        if(!file){
            try {backend.createKey(scope);McpAuthorityCodec.Snapshot state=McpAuthorityCodec.snapshot(UUID.randomUUID().toString(),McpAuthorityCodec.EMPTY);backend.commit(scope,McpAuthorityCodec.seal(scope,state,backend.key(scope)));}
            catch(Exception failure){
                // Only this branch proved both key and state were absent.
                // A readable commit wins over an acknowledgement failure.
                boolean committed=false;try{readUnlocked(scope);committed=true;}catch(Exception unreadable){/* This fresh attempt did not commit readable state. */}
                if(!committed)backend.discardFresh(scope);throw new McpAuthorityCodec.Failure();
            }
        }
        readUnlocked(scope);
    }}
    McpAuthorityCodec.Snapshot read(String scope) throws Exception {synchronized(LOCK){return readUnlocked(scope);}}
    public boolean compareAndSet(String scope,String expected,String payload) throws Exception {synchronized(LOCK){
        McpAuthorityCodec.scope(scope);McpAuthorityCodec.Snapshot current=readUnlocked(scope);
        if(expected==null||!current.revision.equals(expected))return false;
        McpAuthorityCodec.Snapshot next=McpAuthorityCodec.snapshot(UUID.randomUUID().toString(),payload);
        backend.commit(scope,McpAuthorityCodec.seal(scope,next,backend.key(scope)));
        if(!next.revision.equals(readUnlocked(scope).revision))throw new McpAuthorityCodec.Failure();return true;
    }}
    private static final class NativeBackend implements Backend {
        private final Context context;
        NativeBackend(Context context){this.context=context;}
        private File root() throws Exception {
            // Android may return an OS-owned directory alias. Normalize only
            // that trusted base; reject symlinks in our namespace and files.
            File base=context.getNoBackupFilesDir().getCanonicalFile();
            File root=new File(base,"keepany-mcp-authority-v1");
            if(!root.isDirectory()&&!root.mkdirs()||!root.getCanonicalFile().equals(root.getAbsoluteFile()))throw new McpAuthorityCodec.Failure();
            if(!root.setReadable(false,false)||!root.setWritable(false,false)||!root.setExecutable(false,false)||!root.setReadable(true,true)||!root.setWritable(true,true)||!root.setExecutable(true,true))throw new McpAuthorityCodec.Failure();
            return root;
        }
        private File path(String scope,String suffix) throws Exception {
            McpAuthorityCodec.scope(scope);File root=root(),file=new File(root,scope+".enc"+suffix);
            if(!file.getCanonicalFile().equals(file.getAbsoluteFile()))throw new McpAuthorityCodec.Failure();return file;
        }
        private AtomicFile file(String scope) throws Exception {return new AtomicFile(path(scope,""));}
        private String alias(String scope) throws Exception {McpAuthorityCodec.scope(scope);return context.getPackageName()+".mcp-authority.v1."+scope;}
        private KeyStore keys() throws Exception {KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);return keys;}
        public boolean hasFile(String scope) throws Exception {return path(scope,"").exists()||path(scope,".bak").exists()||path(scope,".new").exists();}
        public boolean hasKey(String scope) throws Exception {return keys().containsAlias(alias(scope));}
        public SecretKey key(String scope) throws Exception {Object key=keys().getKey(alias(scope),null);if(!(key instanceof SecretKey))throw new McpAuthorityCodec.Failure();return (SecretKey)key;}
        public void createKey(String scope) throws Exception {
            if(hasKey(scope))throw new McpAuthorityCodec.Failure();KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias(scope),KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());generator.generateKey();
        }
        public byte[] read(String scope) throws Exception {
            for(String suffix:new String[]{"",".bak",".new"})if(path(scope,suffix).length()>McpAuthorityCodec.MAX_ENVELOPE+32)throw new McpAuthorityCodec.Failure();
            byte[] result=file(scope).readFully();if(result.length>McpAuthorityCodec.MAX_ENVELOPE+32)throw new McpAuthorityCodec.Failure();return result;
        }
        public void commit(String scope,byte[] ciphertext) throws Exception {
            AtomicFile store=file(scope);FileOutputStream output=null;boolean finished=false;
            try {output=store.startWrite();output.write(ciphertext);output.getFD().sync();store.finishWrite(output);finished=true;
                if(!Arrays.equals(ciphertext,read(scope)))throw new McpAuthorityCodec.Failure();
            }catch(Exception failure){if(output!=null&&!finished)store.failWrite(output);throw failure;}
        }
        public void discardFresh(String scope) throws Exception {file(scope).delete();keys().deleteEntry(alias(scope));}
    }
}
