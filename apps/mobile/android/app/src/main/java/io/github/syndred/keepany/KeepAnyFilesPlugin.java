package io.github.syndred.keepany;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** System document export, restricted to the app's generated cache exports. */
@CapacitorPlugin(name = "KeepAnyFiles")
public final class KeepAnyFilesPlugin extends Plugin {
    private static final long MAX_BYTES = 100L * 1024 * 1024 + 52;
    private final AtomicBoolean active = new AtomicBoolean();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private static long checkedSize(PluginCall call) throws Exception {
        // JSONObject uses Integer for small JSON numbers; Capacitor.getLong
        // accepts only boxed Long and would reject ordinary generated backups.
        Object raw = call.getData().opt("size");
        if (!(raw instanceof Number)) throw new Exception();
        double value = ((Number) raw).doubleValue();
        if (!Double.isFinite(value) || value != Math.rint(value) || value <= 0 || value > MAX_BYTES) throw new Exception();
        return (long) value;
    }

    private File checkedSource(PluginCall call) throws Exception {
        Iterator<String> keys = call.getData().keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!key.equals("source") && !key.equals("name") && !key.equals("mimeType") && !key.equals("size") && !key.equals("sha256")) throw new Exception();
        }
        String source = call.getString("source"), name = call.getString("name"), mime = call.getString("mimeType"), hash = call.getString("sha256");
        long size = checkedSize(call);
        if (source == null || name == null || mime == null || hash == null ||
            !hash.matches("[0-9a-f]{64}") || name.length() > 180 || !name.matches("[^\\\\/:*?\"<>|\\p{Cntrl}]+") ||
            !name.toLowerCase(java.util.Locale.ROOT).matches(".+\\.(ka1|kdbx|json)") ||
            !(mime.equals("application/octet-stream") || mime.equals("application/json") || mime.equals("application/x-keepass2")) ||
            !source.matches("exports/[0-9a-f-]{36}/[^/]+")) throw new Exception();
        File cache = getContext().getCacheDir().getCanonicalFile();
        File exports = new File(cache, "exports").getCanonicalFile();
        File file = new File(cache, source).getCanonicalFile();
        if (!exports.getPath().startsWith(cache.getPath() + File.separator) || !file.getPath().startsWith(exports.getPath() + File.separator) ||
            !file.getName().equals(name) || !file.isFile() || file.length() != size) throw new Exception();
        try (InputStream input = new FileInputStream(file)) { if (!digest(input, size).equals(hash)) throw new Exception(); }
        return file;
    }
    private static String digest(InputStream input, long expectedSize) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[16 * 1024]; long total = 0; int count;
        while ((count = input.read(buffer)) != -1) {
            if (Thread.currentThread().isInterrupted() || (total += count) > expectedSize) throw new Exception();
            digest.update(buffer, 0, count);
        }
        if (total != expectedSize) throw new Exception();
        StringBuilder hex = new StringBuilder();
        for (byte value : digest.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return hex.toString();
    }
    @PluginMethod public void save(PluginCall call) {
        if (!active.compareAndSet(false, true)) { call.reject("native-export-busy"); return; }
        worker.execute(() -> {
            try {
                checkedSource(call);
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(call.getString("mimeType"));
                intent.putExtra(Intent.EXTRA_TITLE, call.getString("name"));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    try { startActivityForResult(call, intent, "savedDocument"); }
                    catch (Exception error) { active.set(false); call.reject("native-export-unavailable"); }
                });
            } catch (Exception error) { active.set(false); call.reject("native-export-source"); }
        });
    }
    @ActivityCallback private void savedDocument(PluginCall call, ActivityResult result) {
        if (call == null) { active.set(false); return; }
        Uri destination = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || destination == null) {
            active.set(false); JSObject cancelled = new JSObject(); cancelled.put("status", "cancelled"); call.resolve(cancelled); return;
        }
        worker.execute(() -> {
            try {
                File source = checkedSource(call);
                long expectedSize = checkedSize(call);
                try (InputStream input = new FileInputStream(source); OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new Exception();
                    byte[] buffer = new byte[16 * 1024]; int count; long total = 0;
                    while ((count = input.read(buffer)) != -1) {
                        if (Thread.currentThread().isInterrupted() || (total += count) > expectedSize) throw new Exception();
                        output.write(buffer, 0, count);
                    }
                    if (total != expectedSize) throw new Exception();
                    output.flush();
                }
                String actual;
                try (InputStream input = getContext().getContentResolver().openInputStream(destination)) {
                    if (input == null) throw new Exception();
                    actual = digest(input, expectedSize);
                }
                if (!actual.equals(call.getString("sha256"))) throw new Exception();
                JSObject receipt = new JSObject(); receipt.put("status", "saved"); receipt.put("size", expectedSize); receipt.put("sha256", actual);
                call.resolve(receipt);
            } catch (Exception error) { call.reject("native-export-save"); }
            finally { active.set(false); }
        });
    }
    @Override protected void handleOnDestroy() { worker.shutdownNow(); active.set(false); super.handleOnDestroy(); }
}
