package io.github.syndred.keepany;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.*;
import java.util.concurrent.*;

@CapacitorPlugin(name="KeepAnyMcpAuthority")
public final class KeepAnyMcpAuthorityPlugin extends Plugin {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private boolean fields(PluginCall call,String... names){Set<String> expected=new HashSet<>(Arrays.asList(names));Iterator<String> keys=call.getData().keys();while(keys.hasNext())if(!expected.remove(keys.next()))return false;return expected.isEmpty();}
    private void reject(PluginCall call){call.reject("mcp-native-unavailable","mcp-native-unavailable");}
    private McpAuthoritySecureStore store(){return new McpAuthoritySecureStore(getContext());}
    @PluginMethod public void initialize(PluginCall call){if(!fields(call,"scope")){reject(call);return;}worker.execute(()->{try{store().initialize(call.getString("scope"));call.resolve();}catch(Exception failure){reject(call);}});}
    @PluginMethod public void readState(PluginCall call){if(!fields(call,"scope")){reject(call);return;}worker.execute(()->{try{McpAuthorityCodec.Snapshot state=store().read(call.getString("scope"));JSObject result=new JSObject();result.put("revision",state.revision);result.put("payload",state.payload);call.resolve(result);}catch(Exception failure){reject(call);}});}
    @PluginMethod public void compareAndSet(PluginCall call){if(!fields(call,"scope","expectedRevision","payload")){reject(call);return;}worker.execute(()->{try{JSObject result=new JSObject();result.put("committed",store().compareAndSet(call.getString("scope"),call.getString("expectedRevision"),call.getString("payload")));call.resolve(result);}catch(Exception failure){reject(call);}});}
    @Override protected void handleOnDestroy(){worker.shutdownNow();super.handleOnDestroy();}
}
