package io.github.syndred.keepany;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import org.json.JSONObject;

@CapacitorPlugin(name="KeepAnyIdentity")
public final class KeepAnyIdentityPlugin extends Plugin {
    private IdentitySecureStore store() {return new IdentitySecureStore(getContext());}
    private boolean body(PluginCall call,String... names) {
        Set<String> expected=new HashSet<>(Arrays.asList(names));Iterator<String> found=call.getData().keys();
        while(found.hasNext()) if(!expected.remove(found.next())) return false;return expected.isEmpty();
    }
    // No raw exception, state, proof, token, request or key is attached to bridge logs.
    private void reject(PluginCall call) {call.reject("binding-native-unavailable","binding-native-unavailable");}
    @PluginMethod public void initialize(PluginCall call) {
        if(!body(call)){reject(call);return;}try{store().initialize();call.resolve();}catch(Exception failure){reject(call);}
    }
    @PluginMethod public void readState(PluginCall call) {
        if(!body(call)){reject(call);return;}try{JSONObject state=store().read();JSObject result=new JSObject();result.put("revision",state.getString("revision"));result.put("payload",state.getString("payload"));call.resolve(result);}catch(Exception failure){reject(call);}
    }
    @PluginMethod public void compareAndSet(PluginCall call) {
        if(!body(call,"expectedRevision","payload")){reject(call);return;}
        try{JSObject result=new JSObject();result.put("committed",store().compareAndSet(call.getString("expectedRevision"),call.getString("payload")));call.resolve(result);}catch(Exception failure){reject(call);}
    }
    @PluginMethod public void publicKey(PluginCall call) {
        if(!body(call)){reject(call);return;}try{JSONObject key=store().publicKey();JSObject result=new JSObject();result.put("kty",key.getString("kty"));result.put("crv",key.getString("crv"));result.put("x",key.getString("x"));result.put("y",key.getString("y"));call.resolve(result);}catch(Exception failure){reject(call);}
    }
    @PluginMethod public void sign(PluginCall call) {
        if(!body(call,"signingInputBase64")){reject(call);return;}
        try{
            String encoded=call.getString("signingInputBase64");if(encoded==null||encoded.length()>11000||!encoded.matches("[A-Za-z0-9+/]+={0,2}"))throw new IllegalArgumentException();
            JSObject result=new JSObject();result.put("signatureBase64",Base64.encodeToString(store().sign(Base64.decode(encoded,Base64.NO_WRAP)),Base64.NO_WRAP));call.resolve(result);
        }catch(Exception failure){reject(call);}
    }
}
