package io.github.syndred.keepany;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import static org.junit.Assert.*;

/** Prepared for the device lane. Host compilation does not count as execution. */
@RunWith(AndroidJUnit4.class)
public final class IdentityDeviceTest {
 private static byte[] readFile(File file) throws Exception {try(FileInputStream input=new FileInputStream(file);ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);return output.toByteArray();}}
 private static void writeFile(File file,byte[] bytes) throws Exception {try(FileOutputStream output=new FileOutputStream(file)){output.write(bytes);output.getFD().sync();}}
 @Test public void keystorePersistenceCiphertextAndCasStayLocalToThisInstallation() throws Exception {
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();String namespace="identity-test-"+UUID.randomUUID();
  String prefix=context.getPackageName()+"."+namespace;File file=new File(context.getNoBackupFilesDir(),namespace+".enc");
  ExecutorService workers=Executors.newFixedThreadPool(2);
  try {
   IdentitySecureStore first=new IdentitySecureStore(context,namespace);first.initialize();
   JSONObject publicKey=first.publicKey(),before=first.read();String secret="synthetic-refresh-device-code-"+UUID.randomUUID();
   Future<Boolean> one=workers.submit(()->first.compareAndSet(before.getString("revision"),new JSONObject().put("secret",secret).toString()));
   Future<Boolean> two=workers.submit(()->new IdentitySecureStore(context,namespace).compareAndSet(before.getString("revision"),new JSONObject().put("other","competing").toString()));
   assertTrue(one.get()^two.get());
   JSONObject current=first.read();assertFalse(first.compareAndSet(before.getString("revision"),"{}"));
   IdentitySecureStore reopened=new IdentitySecureStore(context,namespace);reopened.initialize();assertTrue(current.toString().equals(reopened.read().toString()));assertTrue(publicKey.toString().equals(reopened.publicKey().toString()));
   byte[] disk=readFile(file);String stored=new String(disk,StandardCharsets.UTF_8);assertFalse(stored.contains(secret));assertFalse(stored.contains("competing"));
   KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);assertNull(keys.getKey(prefix+".sign",null).getEncoded());assertNull(keys.getKey(prefix+".state",null).getEncoded());
   assertEquals(64,reopened.sign("eyJhbGciOiJFUzI1NiJ9.eyJqdGkiOiJmaXh0dXJlIn0".getBytes(StandardCharsets.US_ASCII)).length);
   // Authentication failure must not silently create another device identity.
   JSONObject encrypted=new JSONObject(stored);String ciphertext=encrypted.getString("ciphertext");encrypted.put("ciphertext",(ciphertext.charAt(0)=='A'?"B":"A")+ciphertext.substring(1));writeFile(file,encrypted.toString().getBytes(StandardCharsets.UTF_8));
   try {reopened.initialize();fail("Tampered state accepted");}catch(Exception expected){assertTrue(file.exists());}
  } finally {
   workers.shutdownNow();KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);keys.deleteEntry(prefix+".sign");keys.deleteEntry(prefix+".state");
   file.delete();new File(file.getPath()+".bak").delete();new File(file.getPath()+".new").delete();
  }
 }
 @Test public void freshInitializationWriteFailureCleansOnlyItsNewAliasesAndCanRetry() throws Exception {
  Context base=InstrumentationRegistry.getInstrumentation().getTargetContext();String namespace="identity-init-"+UUID.randomUUID(),prefix=base.getPackageName()+"."+namespace;
  File directory=new File(base.getCacheDir(),namespace);assertTrue(directory.mkdirs());
  Context isolated=new android.content.ContextWrapper(base) {
   @Override public Context getApplicationContext(){return this;}
   @Override public File getNoBackupFilesDir(){return directory;}
  };
  File state=new File(directory,namespace+".enc");KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);
  try {
   IdentitySecureStore store=new IdentitySecureStore(isolated,namespace);assertTrue(directory.setWritable(false,false));
   boolean failed=false;try{store.initialize();}catch(Exception expected){failed=true;}finally{assertTrue(directory.setWritable(true,true));}
   assertTrue(failed);assertFalse(keys.containsAlias(prefix+".sign"));assertFalse(keys.containsAlias(prefix+".state"));assertFalse(state.exists());
   store.initialize();assertTrue(state.exists());assertTrue(store.read().has("revision"));
  }finally{
   directory.setWritable(true,true);keys.deleteEntry(prefix+".sign");keys.deleteEntry(prefix+".state");state.delete();new File(state.getPath()+".bak").delete();new File(state.getPath()+".new").delete();directory.delete();
  }
 }
}
