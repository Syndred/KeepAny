package io.github.syndred.keepany;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContextWrapper;
import android.os.Bundle;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.*;
import java.io.File;
import java.nio.file.Files;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.SecretKey;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.junit.rules.TestRule;
import org.junit.runners.MethodSorters;
import org.junit.runners.model.Statement;

/** Test-only diagnostics: never publish exception messages, arguments, scopes, keys or state. */
@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public final class McpAuthorityBridgeDiagnosticTest {
    private Context target,application;
    private final Set<String> scopes=new LinkedHashSet<>();
    private final List<File> ownedLinks=new ArrayList<>(),ownedMarkers=new ArrayList<>(),ownedDirectories=new ArrayList<>();
    private static volatile boolean linkageFailure;
    @Rule public final TestRule sanitizeUnexpectedFailures=(base,description)->new Statement(){
        @Override public void evaluate() throws Throwable {
            try{base.evaluate();}
            catch(org.junit.AssumptionViolatedException skipped){throw skipped;}
            catch(Throwable error){Trace safe=new Trace("unexpected-or-assertion");safe.first=error;safe.firstStage="test-framework";safe.last="test-framework";safe.publish();throw new AssertionError("Native diagnostic failed; exceptionClass="+error.getClass().getName());}
        }
    };
    private interface Step<T>{T run() throws Exception;}
    private static final class Trace {
        final String test;final List<String> completed=new ArrayList<>(),failed=new ArrayList<>();String last="not-started",firstStage;Throwable first;
        Trace(String test){this.test=test;}
        <T>T step(String name,Step<T> work) throws Exception {
            last=name;try{T result=work.run();completed.add(name);return result;}
            catch(Throwable error){failed.add(name);if(first==null){first=error;firstStage=name;}if(error instanceof LinkageError)linkageFailure=true;
                if(error instanceof Exception)throw (Exception)error;throw new Exception("sanitized diagnostic failure");}
        }
        <T>T probe(String name,Step<T> work){try{return step(name,work);}catch(Exception sanitized){return null;}}
        void publish() throws Exception {
            JSONObject row=new JSONObject().put("test",test).put("lastStage",last).put("completedStages",new JSONArray(completed)).put("failedStages",new JSONArray(failed));
            if(first!=null){row.put("firstStage",firstStage);JSONArray causes=new JSONArray();Set<Throwable> seen=Collections.newSetFromMap(new IdentityHashMap<>());
                for(Throwable error=first;error!=null&&seen.add(error)&&causes.length()<4;error=error.getCause()){
                    JSONArray stack=new JSONArray();StackTraceElement[] elements=error.getStackTrace();for(int i=0;i<Math.min(16,elements.length);i++){StackTraceElement frame=elements[i];stack.put(frame.getClassName()+"."+frame.getMethodName()+":"+frame.getLineNumber());}
                    causes.put(new JSONObject().put("exceptionClass",error.getClass().getName()).put("stackClassMethodLine",stack));
                }row.put("firstExceptionChain",causes);
            }else row.put("outcome","all-stages-passed");emit(row);
        }
        void finish() throws Exception {publish();if(first!=null)fail("Native authority diagnostic first failure: "+test+"/"+firstStage+"/"+first.getClass().getName());}
    }
    private static void emit(JSONObject row){Bundle safe=new Bundle();safe.putString("authorityDiagnostic",row.toString());InstrumentationRegistry.getInstrumentation().sendStatus(2,safe);}
    @Before public void setUp() throws Exception {
        target=InstrumentationRegistry.getInstrumentation().getTargetContext();application=target.getApplicationContext();assertNotNull("actual target application context",application);
        assertTrue("expected target application package",target.getPackageName().equals("io.github.syndred.keepany"));
        File root=new File(application.getNoBackupFilesDir(),"keepany-mcp-authority-v1");
        emit(new JSONObject().put("targetContextClass",target.getClass().getName()).put("applicationContextClass",application.getClass().getName())
            .put("noBackupAbsoluteEqualsCanonical",application.getNoBackupFilesDir().getAbsoluteFile().equals(application.getNoBackupFilesDir().getCanonicalFile()))
            .put("rootAbsoluteEqualsCanonical",root.getAbsoluteFile().equals(root.getCanonicalFile())).put("rootExists",root.exists()).put("rootDirectory",root.isDirectory()));
    }
    private String scope() throws Exception {
        StringBuilder result=new StringBuilder();for(byte part:MessageDigest.getInstance("SHA-256").digest(UUID.randomUUID().toString().getBytes(StandardCharsets.UTF_8)))result.append(String.format(Locale.ROOT,"%02x",part&255));String scope=result.toString();
        assertTrue("only a fresh random diagnostic scope",scopes.add(scope));return scope;
    }
    private String alias(String scope){assertTrue("alias is owned by this diagnostic",scopes.contains(scope));return application.getPackageName()+".mcp-authority.v1."+scope;}
    private KeyStore keys() throws Exception {KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);return keys;}
    private static boolean existsWithoutFollowing(File file) throws Exception {
        try{Os.lstat(file.getAbsolutePath());return true;}catch(ErrnoException error){if(error.errno==OsConstants.ENOENT)return false;throw error;}
    }
    @After public void cleanupOnlyOwnScopes() throws Exception {
        Trace trace=new Trace("owned-cleanup");int removed=0;
        for(File link:ownedLinks)trace.probe("unlink-owned-symlink-without-following",()->{
            if(existsWithoutFollowing(link)){assertTrue("owned fixture remains a symlink",OsConstants.S_ISLNK(Os.lstat(link.getAbsolutePath()).st_mode));assertTrue("unlink only exact owned link",link.delete());}
            assertFalse("owned link absent without following",existsWithoutFollowing(link));return true;});
        for(String scope:scopes){Boolean clean=trace.probe("delete-and-check-owned-key",()->{KeyStore keys=keys();keys.deleteEntry(alias(scope));return !keys.containsAlias(alias(scope));});if(Boolean.TRUE.equals(clean))removed++;
            File root=new File(application.getNoBackupFilesDir(),"keepany-mcp-authority-v1");File canonical=root.getCanonicalFile();
            for(String suffix:new String[]{"",".bak",".new"})trace.probe("delete-and-check-owned-file",()->{File file=new File(root,scope+".enc"+suffix);
                assertTrue("cleanup stays in formal namespace and owned exact filename",file.getCanonicalFile().getParentFile().equals(canonical));
                assertFalse("unexpected directory is never recursively deleted",file.isDirectory());if(file.exists())assertTrue("remove only random owned file",file.delete());assertFalse("owned file absent",file.exists());return true;});
        }
        for(File marker:ownedMarkers)trace.probe("delete-owned-marker",()->{assertFalse("marker is not a symlink",OsConstants.S_ISLNK(Os.lstat(marker.getAbsolutePath()).st_mode));assertTrue("remove exact owned marker",marker.delete());assertFalse("marker absent",existsWithoutFollowing(marker));return true;});
        List<File> reverseDirectories=new ArrayList<>(ownedDirectories);Collections.reverse(reverseDirectories);
        for(File directory:reverseDirectories)trace.probe("delete-empty-owned-directory",()->{assertTrue("fixture directory remains canonical",directory.getCanonicalFile().equals(directory.getAbsoluteFile()));assertTrue("remove only empty owned fixture directory",directory.delete());assertFalse("owned directory absent",existsWithoutFollowing(directory));return true;});
        emit(new JSONObject().put("cleanupOwnedScopeCount",scopes.size()).put("cleanupOwnedAliasesConfirmedAbsent",removed));trace.finish();assertEquals("all exact owned aliases gone",scopes.size(),removed);
    }
    private File ownDirectory(File parent) throws Exception {
        File directory=new File(parent,"authority-diagnostic-"+UUID.randomUUID());assertTrue("new isolated directory",directory.mkdir());ownedDirectories.add(directory);return directory;
    }
    private File marker(File directory,byte[] bytes) throws Exception {
        File marker=new File(directory,"nonsecret-marker");Files.write(marker.toPath(),bytes);ownedMarkers.add(marker);return marker;
    }
    private void link(File target,File path) throws Exception {
        assertFalse("fresh exact link path",existsWithoutFollowing(path));ownedLinks.add(path);Os.symlink(target.getAbsolutePath(),path.getAbsolutePath());
        assertTrue("fixture is an actual symlink",OsConstants.S_ISLNK(Os.lstat(path.getAbsolutePath()).st_mode));
    }
    private void rejectsLinkedState(McpAuthoritySecureStore store,String scope,File linkedPath,File marker,byte[] expected) throws Exception {
        try{store.initialize(scope);fail("linked state initialize must fail closed");}catch(McpAuthorityCodec.Failure expectedFailure){/* Fixed native failure only. */}
        try{store.read(scope);fail("linked state read must fail closed");}catch(McpAuthorityCodec.Failure expectedFailure){/* No target content is accepted. */}
        assertTrue("rejection leaves exact fixture link for explicit cleanup",OsConstants.S_ISLNK(Os.lstat(linkedPath.getAbsolutePath()).st_mode));
        assertArrayEquals("external owned marker bytes unchanged",expected,Files.readAllBytes(marker.toPath()));assertFalse("no key created for rejected link",keys().containsAlias(alias(scope)));
    }
    private McpAuthoritySecureStore.Backend backend(McpAuthoritySecureStore store) throws Exception {Field field=McpAuthoritySecureStore.class.getDeclaredField("backend");field.setAccessible(true);return (McpAuthoritySecureStore.Backend)field.get(store);}
    private static final class TrackingBackend implements McpAuthoritySecureStore.Backend {
        final McpAuthoritySecureStore.Backend actual;final Trace trace;
        TrackingBackend(McpAuthoritySecureStore.Backend actual,Trace trace){this.actual=actual;this.trace=trace;}
        public boolean hasFile(String scope)throws Exception{return trace.step("backend.hasFile",()->actual.hasFile(scope));}
        public boolean hasKey(String scope)throws Exception{return trace.step("backend.hasKey",()->actual.hasKey(scope));}
        public SecretKey key(String scope)throws Exception{return trace.step("backend.key",()->actual.key(scope));}
        public void createKey(String scope)throws Exception{trace.step("backend.createKey",()->{actual.createKey(scope);return null;});}
        public byte[] read(String scope)throws Exception{return trace.step("backend.read",()->actual.read(scope));}
        public void commit(String scope,byte[] bytes)throws Exception{trace.step("backend.commit",()->{actual.commit(scope,bytes);return null;});}
        public void discardFresh(String scope)throws Exception{trace.step("backend.discardFresh",()->{actual.discardFresh(scope);return null;});}
    }

    @Test public void a_actualApplicationContextFreshInitializeIdempotentAndReopen() throws Exception {
        String scope=scope();Trace trace=new Trace("actual-application-initialize");McpAuthoritySecureStore store=new McpAuthoritySecureStore(target);
        trace.probe("actual.initialize",()->{store.initialize(scope);return true;});
        if(trace.first==null){McpAuthorityCodec.Snapshot first=trace.probe("actual.read",()->store.read(scope));
            trace.probe("actual.initialize-existing",()->{new McpAuthoritySecureStore(application).initialize(scope);return true;});
            McpAuthorityCodec.Snapshot reopened=trace.probe("actual.reopen-read",()->new McpAuthoritySecureStore(application).read(scope));
            if(first!=null&&reopened!=null)trace.probe("actual.metadata-equal",()->{assertTrue("same original revision",first.revision.equals(reopened.revision));assertTrue("same metadata only",first.payload.equals(reopened.payload));return true;});
        }trace.finish();
    }
    @Test public void b_traceActualBackendFirstFailureBeforeInitializeSanitizesIt() throws Exception {
        String scope=scope();Trace trace=new Trace("tracked-production-backend");McpAuthoritySecureStore original=new McpAuthoritySecureStore(target);
        McpAuthoritySecureStore traced=new McpAuthoritySecureStore(new TrackingBackend(backend(original),trace));
        // The wrapper preserves the first backend failure before initialize's fresh rollback/read retry can replace it.
        trace.probe("store.initialize",()->{traced.initialize(scope);return true;});trace.finish();
    }
    @Test public void c_stepKeyCodecAtomicFileWithoutPrintingDiagnosticMessages() throws Exception {
        String scope=scope();Trace trace=new Trace("explicit-key-codec-file");McpAuthoritySecureStore.Backend source=backend(new McpAuthoritySecureStore(application));
        trace.probe("hasFile",()->source.hasFile(scope));Boolean hasKey=trace.probe("hasKey",()->source.hasKey(scope));
        if(Boolean.FALSE.equals(hasKey))trace.probe("createKey",()->{source.createKey(scope);return true;});
        SecretKey key=trace.probe("key",()->source.key(scope));McpAuthorityCodec.Snapshot snapshot=trace.probe("snapshot",()->McpAuthorityCodec.snapshot(UUID.randomUUID().toString(),McpAuthorityCodec.EMPTY));
        byte[] frame=key!=null&&snapshot!=null?trace.probe("seal",()->McpAuthorityCodec.seal(scope,snapshot,key)):null;
        if(frame!=null){Boolean committed=trace.probe("commit",()->{source.commit(scope,frame);return true;});
            byte[] disk=Boolean.TRUE.equals(committed)?trace.probe("read",()->source.read(scope)):null;
            if(disk!=null)trace.probe("open-disk",()->McpAuthorityCodec.open(scope,disk,key));
            trace.probe("open-own-memory-frame",()->McpAuthorityCodec.open(scope,frame,key));
        }trace.finish();
    }
    private static final class Result {final boolean resolved;final JSObject data;final String code;Result(boolean resolved,JSObject data,String code){this.resolved=resolved;this.data=data;this.code=code;}}
    private static final class CapturedCall extends PluginCall {
        final CompletableFuture<Result> result=new CompletableFuture<>();
        CapturedCall(String method,JSObject data){super(null,"KeepAnyMcpAuthority","synthetic-diagnostic",method,data);}
        @Override public void resolve(){result.complete(new Result(true,null,null));}
        @Override public void resolve(JSObject data){result.complete(new Result(true,data,null));}
        @Override public void reject(String ignoredMessage,String code){String fixed=code!=null&&code.matches("mcp-native-[a-z-]+")?code:"diagnostic-native-rejected";result.complete(new Result(false,null,fixed));}
        @Override public void errorCallback(String ignoredMessage){result.complete(new Result(false,null,"diagnostic-bridge-rejected"));}
    }
    @Test public void d_registeredActivityBridgeInitializesOnlyFreshScopeWithFormalPluginCall() throws Exception {
        Assume.assumeFalse("ABI failure already captured; do not crash an async native worker",linkageFailure);
        String scope=scope();Trace trace=new Trace("registered-bridge-plugin-call");CapturedCall initialize=new CapturedCall("initialize",new JSObject().put("scope",scope));
        emit(new JSONObject().put("optionKeys",new JSONArray().put("scope")).put("scopeJavaTypeString",initialize.getData().opt("scope") instanceof String).put("scopeLength",scope.length()).put("scopeHex64",scope.matches("[a-f0-9]{64}")));
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            scenario.onActivity(activity->{
                trace.probe("bridge.lookup-and-dispatch",()->{Bridge bridge=activity.getBridge();assertNotNull("actual activity bridge",bridge);
                    PluginHandle handle=bridge.getPlugin("KeepAnyMcpAuthority");assertNotNull("registered authority handle",handle);assertTrue("formal authority instance",handle.getInstance() instanceof KeepAnyMcpAuthorityPlugin);
                    assertFalse("bridge argument logging must remain disabled",Logger.shouldLog());
                    emit(new JSONObject().put("pluginContextClass",handle.getInstance().getContext().getClass().getName()).put("bridgeLoggingDisabled",true));
                    bridge.callPluginMethod("KeepAnyMcpAuthority","initialize",initialize);return true;});
            });
            if(trace.first==null){Result initialized=trace.probe("bridge.initialize-ack",()->initialize.result.get(30,TimeUnit.SECONDS));
                if(initialized!=null){emit(new JSONObject().put("bridgeInitializeResolved",initialized.resolved).put("bridgeInitializeCode",initialized.code==null?JSONObject.NULL:initialized.code));
                    if(!initialized.resolved)trace.probe("bridge.initialize-rejected",()->{throw new Exception("sanitized bridge rejection");});
                    else{CapturedCall read=new CapturedCall("readState",new JSObject().put("scope",scope));scenario.onActivity(activity->activity.getBridge().callPluginMethod("KeepAnyMcpAuthority","readState",read));
                        Result state=trace.probe("bridge.readState-ack",()->read.result.get(30,TimeUnit.SECONDS));
                        if(state!=null)trace.probe("bridge.readState-shape",()->{assertTrue("readState resolved",state.resolved);assertNotNull("metadata result",state.data);assertTrue("revision is a UUID",state.data.getString("revision").matches("[a-fA-F0-9-]{36}"));JSONObject payload=new JSONObject(state.data.getString("payload"));assertEquals("fresh four arrays",4,payload.length());return true;});
                    }
                }
            }
        }trace.finish();
    }
    @Test public void e_exactFreshScopeFileSymlinkRejectedWithoutChangingMarkerOrCreatingKey() throws Exception {
        String scope=scope();McpAuthoritySecureStore store=new McpAuthoritySecureStore(application);
        assertFalse("actual trusted base accepted before negative fixture",backend(store).hasFile(scope));
        File root=new File(application.getNoBackupFilesDir().getCanonicalFile(),"keepany-mcp-authority-v1");
        File directory=ownDirectory(application.getNoBackupFilesDir().getCanonicalFile());byte[] expected="isolated-nonsecret-file-marker".getBytes(StandardCharsets.UTF_8);
        File marker=marker(directory,expected),linkedPath=new File(root,scope+".enc");link(marker,linkedPath);rejectsLinkedState(store,scope,linkedPath,marker,expected);
        emit(new JSONObject().put("symlinkGuard","exact-scope-file").put("initializeAndReadRejected",true).put("markerUnchanged",true).put("keyAbsent",true));
    }
    @Test public void f_isolatedNamespaceSymlinkRejectedWithoutTouchingFormalNamespace() throws Exception {
        String scope=scope();File isolated=ownDirectory(application.getNoBackupFilesDir().getCanonicalFile());
        Context wrapper=new ContextWrapper(application){@Override public Context getApplicationContext(){return this;}@Override public File getNoBackupFilesDir(){return isolated;}};
        McpAuthoritySecureStore store=new McpAuthoritySecureStore(wrapper);assertFalse("isolated canonical control accepted",backend(store).hasFile(scope));
        File namespace=new File(isolated,"keepany-mcp-authority-v1");assertTrue("remove only own empty control namespace",namespace.delete());
        File destination=ownDirectory(isolated);byte[] expected="isolated-nonsecret-namespace-marker".getBytes(StandardCharsets.UTF_8);File marker=marker(destination,expected);
        link(destination,namespace);rejectsLinkedState(store,scope,namespace,marker,expected);
        emit(new JSONObject().put("symlinkGuard","isolated-namespace").put("initializeAndReadRejected",true).put("markerUnchanged",true).put("keyAbsent",true));
    }
}
