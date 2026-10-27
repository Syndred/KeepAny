package io.github.syndred.keepany;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;

@CapacitorPlugin(name = "KeepAnyMetadata")
public final class KeepAnyMetadataPlugin extends Plugin {
    private final MetadataCoordinator requests = new MetadataCoordinator();
    private boolean checked(PluginCall call, boolean reading) {
        Iterator<String> keys = call.getData().keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!key.equals("requestId") && !(reading && key.equals("url"))) return false;
        }
        Object id = call.getData().opt("requestId"), url = call.getData().opt("url");
        return id instanceof String && ((String) id).matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}") && (!reading || url instanceof String);
    }
    @PluginMethod public void read(PluginCall call) {
        if (!checked(call, true)) { call.reject("metadata-body", "metadata-body"); return; }
        requests.read(call.getString("requestId"), call.getString("url"), (result, error) -> {
            // Never attach raw exceptions, URLs or response HTML to bridge logs.
            if (error != null) { call.reject(error, error); return; }
            JSObject value = new JSObject();
            value.put("url", result.url); value.put("contentType", result.contentType);
            value.put("bodyBase64", Base64.encodeToString(result.bytes, Base64.NO_WRAP));
            call.resolve(value);
        });
    }
    @PluginMethod public void cancel(PluginCall call) {
        if (!checked(call, false)) { call.reject("metadata-body", "metadata-body"); return; }
        requests.cancel(call.getString("requestId")); call.resolve();
    }
    @Override protected void handleOnDestroy() { requests.close(); super.handleOnDestroy(); }
}
