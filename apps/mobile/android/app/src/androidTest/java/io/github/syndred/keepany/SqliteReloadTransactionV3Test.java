package io.github.syndred.keepany;

import static org.junit.Assert.*;
import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSArray;
import com.getcapacitor.community.database.sqlite.CapacitorSQLite;
import com.getcapacitor.community.database.sqlite.SQLite.SqliteConfig;
import com.getcapacitor.community.database.sqlite.SQLite.Database;
import java.io.File;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.junit.runners.MethodSorters;

/**
 * Actual Android/SQLCipher and actual WebView document replacement; not node:sqlite.
 * Calls the pinned SDK implementation on one dedicated thread, like CapacitorPlugins.
 * Only random keepany-reload-probe-UUID databases in the target context are touched.
 * Running instrumentation starts/replaces the target process. It is not a harmless
 * observation of an existing failing process. The old SDK is EXPECTED TO FAIL test b.
 */
@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public final class SqliteReloadTransactionV3Test {
    private Context context;
    private HandlerThread thread;
    private Handler queue;
    private CapacitorSQLite sqlite;
    private final Set<String> owned = new LinkedHashSet<>();
    private final Set<String> connected = new LinkedHashSet<>();
    private final Set<String> deferred = new LinkedHashSet<>();
    private final Map<String, Database> direct = new LinkedHashMap<>();
    private final List<WebView> views = new ArrayList<>();
    private final JSONArray events = new JSONArray();
    private long started;
    private String test = "setup", stage = "setup";
    private boolean documentReplaced;
    private volatile boolean outerMarkerProvenBeforeReload, nestedMarkerProvenBeforeReload, writtenRollbackPreconditionProven, directNestedMarkersProven;
    private final AtomicInteger oldContinuationCalls = new AtomicInteger();
    private interface Work<T> { T run() throws Exception; }
    private static final class SafeFailure extends Exception {
        SafeFailure(String stage, String code) { super(stage + "/" + code); }
    }
    private static String code(Throwable error) {
        String message = error.getMessage();
        if (message != null && message.toLowerCase(Locale.ROOT).matches("(?s).*(database is locked|database locked|code 5|sqlite_busy).*")) return "database-locked";
        if (message != null && message.contains("No available connection")) return "no-connection";
        if (error instanceof AssertionError) return "assertion";
        return error instanceof SafeFailure ? "prior-safe-failure" : "other-" + error.getClass().getSimpleName();
    }
    private synchronized void event(String name, String outcome, String fixedCode) {
        try { JSONObject row = new JSONObject().put("ms", SystemClock.elapsedRealtime() - started).put("stage", name).put("outcome", outcome);
            if (fixedCode != null) row.put("code", fixedCode); events.put(row);
        } catch (JSONException impossible) { throw new AssertionError("fixed trace serialization"); }
    }
    private <T> T nativeStep(String name, Work<T> work) throws Exception {
        stage = name; event(name, "call", null);
        FutureTask<T> future = new FutureTask<>(() -> {
            assertSame("single native handler thread", thread, Thread.currentThread());
            return work.run();
        });
        if (!queue.post(future)) throw new SafeFailure(name, "queue-closed");
        try { T value = future.get(12, TimeUnit.SECONDS); event(name, "resolved", null); return value; }
        catch (ExecutionException error) { Throwable cause = error.getCause(); String fixedCode = code(cause); event(name, "rejected", fixedCode); throw new SafeFailure(name, fixedCode); }
        catch (TimeoutException error) { event(name, "rejected", "native-step-timeout"); throw new SafeFailure(name, "native-step-timeout"); }
    }
    @Before public void prepare() throws Exception {
        started = SystemClock.elapsedRealtime();
        context = InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();
        assertEquals("explicit target context", "io.github.syndred.keepany", context.getPackageName());
        thread = new HandlerThread("KeepAnySqliteReloadProbe"); thread.start(); queue = new Handler(thread.getLooper());
        sqlite = nativeStep("construct-fixed-sdk", () -> { SqliteConfig config = new SqliteConfig(); config.setIsEncryption(false); config.setBiometricAuth(false); return new CapacitorSQLite(context, config); });
    }
    private String fresh() {
        String name = "keepany-reload-probe-" + UUID.randomUUID();
        assertTrue("strict random database prefix", name.matches("keepany-reload-probe-[a-f0-9-]{36}"));
        assertTrue("fresh name", owned.add(name)); return name;
    }
    private void open(String name) throws Exception {
        assertTrue("only owned database", owned.contains(name));
        nativeStep("create-owned-connection", () -> { sqlite.createConnection(name, false, "no-encryption", 1, new Hashtable<Integer, JSONObject>(), false); connected.add(name); return null; });
        nativeStep("open-owned-connection", () -> { sqlite.open(name, false); return null; });
        nativeStep("driver-wal-full-check", () -> {
            assertEquals("wal mode", "wal", sqlite.query(name, "PRAGMA journal_mode=WAL", new JSArray(), false).getJSONObject(0).getString("journal_mode"));
            sqlite.execute(name, "PRAGMA synchronous=FULL;\nPRAGMA foreign_keys=ON;", false, false);
            assertEquals("full durability", 2, sqlite.query(name, "PRAGMA synchronous", new JSArray(), false).getJSONObject(0).getInt("synchronous")); return null;
        });
    }
    private void baseline(String name) throws Exception {
        open(name);
        nativeStep("commit-synthetic-baseline", () -> {
            sqlite.execute(name, "CREATE TABLE probe(id TEXT PRIMARY KEY,value TEXT NOT NULL);", false, false);
            sqlite.beginTransaction(name);
            sqlite.execute(name, "INSERT INTO probe(id,value) VALUES('committed','baseline-v1');", false, false);
            sqlite.commitTransaction(name); return null;
        });
    }
    private void assertBaseline(String name) throws Exception {
        nativeStep("exact-baseline-and-no-uncommitted-marker", () -> {
            JSArray rows = sqlite.query(name, "SELECT id,value FROM probe ORDER BY id", new JSArray(), false);
            assertEquals("exact committed row count", 1, rows.length());
            assertEquals("exact committed identity", "committed", rows.getJSONObject(0).getString("id"));
            assertEquals("exact committed value", "baseline-v1", rows.getJSONObject(0).getString("value")); return null;
        });
    }
    private void close(String name) throws Exception {
        nativeStep("close-exact-owned-connection", () -> { sqlite.closeConnection(name, false); connected.remove(name); return null; });
    }
    @Test(timeout = 45_000) public void a_committedClosePreservesAnotherLiveConnection() throws Exception {
        test = "normal-close-live-other";
        String primary = fresh(), other = fresh(); baseline(primary); baseline(other); close(primary);
        nativeStep("other-remains-live", () -> { assertTrue("precise close leaves other connection open", sqlite.isDBOpen(other, false)); return null; });
        assertBaseline(other); open(primary); assertBaseline(primary);
        nativeStep("normal-reopen-can-begin-rollback", () -> { sqlite.beginTransaction(primary); sqlite.rollbackTransaction(primary); return null; });
    }
    public final class DocumentBridge {
        private final String name;
        private final boolean withSavepoint;
        final CountDownLatch begun = new CountDownLatch(1), replaced = new CountDownLatch(1);
        final AtomicReference<String> failure = new AtomicReference<>();
        DocumentBridge(String name, boolean withSavepoint) { this.name = name; this.withSavepoint = withSavepoint; }
        @JavascriptInterface public void beginUncommitted() {
            try { nativeStep("old-document-begin-uncommitted-marker", () -> { sqlite.beginTransaction(name); sqlite.execute(name, "INSERT INTO probe(id,value) VALUES('uncommitted','must-rollback');", false, false); if (withSavepoint) {
                    sqlite.execute(name, "SAVEPOINT nested_owned;", false, false);
                    sqlite.execute(name, "INSERT INTO probe(id,value) VALUES('nested','also-must-rollback');", false, false);
                }
                assertTrue("transaction active before replacing the document", sqlite.isTransactionActive(name));
                JSArray before = sqlite.query(name, "SELECT id,value FROM probe ORDER BY id", new JSArray(), false);
                assertEquals("all intended markers were really written", withSavepoint ? 3 : 2, before.length());
                assertEquals("baseline id before reload", "committed", before.getJSONObject(0).getString("id"));
                assertEquals("baseline value before reload", "baseline-v1", before.getJSONObject(0).getString("value"));
                int outerIndex = withSavepoint ? 2 : 1;
                assertEquals("outer marker id before reload", "uncommitted", before.getJSONObject(outerIndex).getString("id"));
                assertEquals("outer marker value before reload", "must-rollback", before.getJSONObject(outerIndex).getString("value"));
                outerMarkerProvenBeforeReload = true;
                if (withSavepoint) {
                    assertEquals("nested marker id before reload", "nested", before.getJSONObject(1).getString("id"));
                    assertEquals("nested marker value before reload", "also-must-rollback", before.getJSONObject(1).getString("value"));
                    nestedMarkerProvenBeforeReload = true;
                }
                event(withSavepoint ? "both-savepoint-markers-proven-before-reload" : "outer-marker-proven-before-reload", "resolved", null); return null; }); }
            catch (Exception error) { failure.set(code(error)); }
            finally { begun.countDown(); }
        }
        @JavascriptInterface public void oldContinuation() { oldContinuationCalls.incrementAndGet(); }
        @JavascriptInterface public void newDocument(boolean oldResolverAbsent) { documentReplaced = oldResolverAbsent; replaced.countDown(); }
    }
    @SuppressLint("SetJavaScriptEnabled")
    private void replaceRealDocumentAfterBegin(String name) throws Exception { replaceRealDocumentAfterBegin(name, false); }
    @SuppressLint("SetJavaScriptEnabled")
    private void replaceRealDocumentAfterBegin(String name, boolean withSavepoint) throws Exception {
        DocumentBridge bridge = new DocumentBridge(name, withSavepoint);
        AtomicReference<WebView> web = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView view = new WebView(context); view.getSettings().setJavaScriptEnabled(true); view.addJavascriptInterface(bridge, "Probe"); views.add(view); web.set(view);
            view.loadDataWithBaseURL("https://keepany-sqlite-probe.invalid/old", "<script>window.pendingCommit=new Promise(resolve=>window.finishOldTransaction=resolve);window.pendingCommit.then(()=>Probe.oldContinuation());Probe.beginUncommitted();</script>", "text/html", "UTF-8", null);
        });
        assertTrue("old document native begin completed", bridge.begun.await(12, TimeUnit.SECONDS));
        assertNull("old document begin succeeds", bridge.failure.get());
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> web.get().loadDataWithBaseURL("https://keepany-sqlite-probe.invalid/reloaded", "<script>Probe.newDocument(typeof window.finishOldTransaction==='undefined');</script>", "text/html", "UTF-8", null));
        assertTrue("real replacement document loaded", bridge.replaced.await(12, TimeUnit.SECONDS));
        assertTrue("old JS resolver removed by actual document replacement", documentReplaced);
        assertEquals("old JS continuation cannot commit", 0, oldContinuationCalls.get());
        event("actual-webview-document-replaced", "resolved", null);
    }
    @Test(timeout = 65_000) public void b_documentReloadUncommittedTransactionMustRollbackBeforeReopen() throws Exception {
        test = "reload-uncommitted-consistency-reopen";
        String primary = fresh(), other = fresh(); baseline(primary); baseline(other);
        replaceRealDocumentAfterBegin(primary);
        // The official empty-dictionary consistency operation intentionally closes
        // all connections in THIS isolated SDK instance. It never sees user DBs.
        deferred.add(primary);
        nativeStep("official-empty-js-manager-consistency", () -> { assertFalse("empty manager reconciliation result", sqlite.checkConnectionsConsistency(new JSArray(), new JSArray())); connected.clear(); return null; });
        open(primary); assertBaseline(primary);
        try {
            nativeStep("first-begin-after-reload", () -> { sqlite.beginTransaction(primary); sqlite.rollbackTransaction(primary); return null; });
            deferred.remove(primary);
        } finally {
            // Content preservation is checked even if the first new BEGIN failed.
            open(other); assertBaseline(other);
        }
        assertBaseline(primary);
    }
    @Test(timeout = 45_000) public void c_writtenCommitAndWrittenRollbackRemainDistinct() throws Exception {
        test = "written-commit-and-written-rollback";
        String name = fresh(); baseline(name);
        nativeStep("write-and-commit-new-value", () -> { sqlite.beginTransaction(name); sqlite.execute(name, "UPDATE probe SET value='committed-v2' WHERE id='committed';", false, false); sqlite.commitTransaction(name); return null; });
        close(name); open(name);
        nativeStep("committed-new-value-survives-close", () -> { JSArray rows = sqlite.query(name, "SELECT id,value FROM probe ORDER BY id", new JSArray(), false); assertEquals("one committed row", 1, rows.length()); assertEquals("original id", "committed", rows.getJSONObject(0).getString("id")); assertEquals("new committed value", "committed-v2", rows.getJSONObject(0).getString("value")); return null; });
        nativeStep("write-then-explicit-rollback", () -> { sqlite.beginTransaction(name); sqlite.execute(name, "UPDATE probe SET value='must-not-survive' WHERE id='committed';", false, false);
            sqlite.execute(name, "INSERT INTO probe(id,value) VALUES('rollback-marker','must-not-survive');", false, false);
            assertTrue("explicit rollback transaction active", sqlite.isTransactionActive(name));
            JSArray before = sqlite.query(name, "SELECT id,value FROM probe ORDER BY id", new JSArray(), false);
            assertEquals("rollback precondition really wrote two rows", 2, before.length());
            assertEquals("changed committed row id", "committed", before.getJSONObject(0).getString("id"));
            assertEquals("changed value exists before rollback", "must-not-survive", before.getJSONObject(0).getString("value"));
            assertEquals("insert marker exists before rollback", "rollback-marker", before.getJSONObject(1).getString("id"));
            assertEquals("insert marker value before rollback", "must-not-survive", before.getJSONObject(1).getString("value"));
            writtenRollbackPreconditionProven = true; event("written-rollback-preconditions-proven", "resolved", null);
            sqlite.rollbackTransaction(name); return null; });
        close(name); open(name);
        nativeStep("rollback-preserves-prior-commit", () -> { JSArray rows = sqlite.query(name, "SELECT id,value FROM probe ORDER BY id", new JSArray(), false); assertEquals("rollback removes marker", 1, rows.length()); assertEquals("same committed id", "committed", rows.getJSONObject(0).getString("id")); assertEquals("rollback keeps last committed value", "committed-v2", rows.getJSONObject(0).getString("value")); return null; });
    }
    @Test(timeout = 65_000) public void d_documentReloadWithNativeStoreSavepointRollsBackWholeOuterTransaction() throws Exception {
        test = "reload-native-store-sql-savepoint";
        String primary = fresh(), other = fresh(); baseline(primary); baseline(other);
        replaceRealDocumentAfterBegin(primary, true);
        deferred.add(primary);
        nativeStep("official-empty-js-manager-consistency", () -> { assertFalse("empty manager reconciliation result", sqlite.checkConnectionsConsistency(new JSArray(), new JSArray())); connected.clear(); return null; });
        open(primary); assertBaseline(primary);
        try { nativeStep("first-begin-after-savepoint-reload", () -> { sqlite.beginTransaction(primary); sqlite.rollbackTransaction(primary); return null; }); deferred.remove(primary); }
        finally { open(other); assertBaseline(other); }
        assertBaseline(primary);
    }
    private Database freshDirectConnection(String name) {
        Database database = new Database(context, name + "SQLite.db", false, "no-encryption", 1, false, new Hashtable<Integer, JSONObject>(), null, false);
        direct.put(name, database); return database;
    }
    @Test(timeout = 45_000) public void e_closeDrainsDirectSqlcipherNestedUnsuccessfulTransactions() throws Exception {
        test = "direct-sqlcipher-nested-close";
        String name = fresh(); deferred.add(name);
        nativeStep("direct-nested-uncommitted-then-close", () -> {
            Database database = freshDirectConnection(name); database.open();
            assertEquals("direct nested WAL mode", "wal", database.selectSQL("PRAGMA journal_mode=WAL", new ArrayList<Object>()).getJSONObject(0).getString("journal_mode"));
            database.execute(new String[]{"PRAGMA synchronous=FULL;", "PRAGMA foreign_keys=ON;"}, false);
            assertEquals("direct nested full durability", 2, database.selectSQL("PRAGMA synchronous", new ArrayList<Object>()).getJSONObject(0).getInt("synchronous"));
            database.execute(new String[]{"CREATE TABLE probe(id TEXT PRIMARY KEY,value TEXT NOT NULL);"}, false);
            database.beginTransaction(); database.execute(new String[]{"INSERT INTO probe(id,value) VALUES('committed','baseline-v1');"}, false); database.commitTransaction();
            // Official public SupportSQLiteDatabase supports native nesting. The
            // app itself uses SQL SAVEPOINT, separately covered by test d.
            database.getDb().beginTransaction();
            database.execute(new String[]{"INSERT INTO probe(id,value) VALUES('outer','must-rollback');"}, false);
            database.getDb().beginTransaction();
            database.execute(new String[]{"INSERT INTO probe(id,value) VALUES('inner','must-rollback');"}, false);
            assertTrue("native nested transaction active", database.getDb().inTransaction());
            JSArray before = database.selectSQL("SELECT id,value FROM probe ORDER BY id", new ArrayList<Object>());
            assertEquals("both native nested markers really exist", 3, before.length());
            assertEquals("nested baseline identity", "committed", before.getJSONObject(0).getString("id"));
            assertEquals("nested baseline value", "baseline-v1", before.getJSONObject(0).getString("value"));
            assertEquals("inner native marker identity", "inner", before.getJSONObject(1).getString("id"));
            assertEquals("inner native marker value", "must-rollback", before.getJSONObject(1).getString("value"));
            assertEquals("outer native marker identity", "outer", before.getJSONObject(2).getString("id"));
            assertEquals("outer native marker value", "must-rollback", before.getJSONObject(2).getString("value"));
            directNestedMarkersProven = true; event("both-direct-native-nested-markers-proven", "resolved", null);
            database.close(); return null;
        });
        nativeStep("direct-nested-reopen-first-begin-and-exact-baseline", () -> {
            Database database = freshDirectConnection(name); database.open(); database.beginTransaction(); database.rollbackTransaction();
            JSArray rows = database.selectSQL("SELECT id,value FROM probe ORDER BY id", new ArrayList<Object>());
            assertEquals("both native nested writes rolled back", 1, rows.length()); assertEquals("baseline id", "committed", rows.getJSONObject(0).getString("id")); assertEquals("baseline value", "baseline-v1", rows.getJSONObject(0).getString("value")); return null;
        });
        deferred.remove(name);
    }
    @After public void finishOnlyOwned() throws Exception {
        for (WebView view : views) InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> { view.removeJavascriptInterface("Probe"); view.destroy(); });
        for (Map.Entry<String, Database> entry : direct.entrySet()) {
            try { nativeStep("close-owned-direct-connection", () -> { if (entry.getValue().isOpen()) entry.getValue().close(); return null; }); }
            catch (Exception error) { deferred.add(entry.getKey()); event("owned-direct-close-cleanup", "rejected", code(error)); }
        }
        for (String name : new ArrayList<>(connected)) {
            try { close(name); } catch (Exception error) { deferred.add(name); event("owned-close-cleanup", "rejected", code(error)); }
        }
        for (String name : owned) {
            File file = context.getDatabasePath(name + "SQLite.db");
            assertTrue("strict owned database filename", file.getName().matches("keepany-reload-probe-[a-f0-9-]{36}SQLite\\.db"));
            assertEquals("database parent remains app database directory", context.getDatabasePath("unusedSQLite.db").getParentFile().getCanonicalFile(), file.getParentFile().getCanonicalFile());
            if (!deferred.contains(name)) {
                // No active/orphan transaction on this name. Context deletes only
                // this exact random DB and its SQLite sidecars, never a directory.
                context.deleteDatabase(file.getName());
                assertFalse("owned closed DB removed", file.exists());
            }
        }
        JSONObject result = new JSONObject().put("test", test).put("lastStage", stage).put("events", events)
            .put("ownedDatabaseNames", new JSONArray(owned)).put("deferredUntilTargetProcessExit", new JSONArray(deferred))
            .put("actualDocumentReplaced", documentReplaced).put("oldContinuationCalls", oldContinuationCalls.get())
            .put("outerMarkerProvenBeforeReload", outerMarkerProvenBeforeReload).put("nestedMarkerProvenBeforeReload", nestedMarkerProvenBeforeReload)
            .put("writtenRollbackPreconditionProven", writtenRollbackPreconditionProven).put("directNestedMarkersProven", directNestedMarkersProven)
            .put("touchesOriginalOr135", false).put("testMutatesProductionSdk", false);
        Bundle output = new Bundle(); output.putString("sqliteReloadProbe", result.toString()); InstrumentationRegistry.getInstrumentation().sendStatus(2, output);
        thread.quitSafely(); thread.join(2_000);
        assertFalse("own handler exited", thread.isAlive());
    }
}
