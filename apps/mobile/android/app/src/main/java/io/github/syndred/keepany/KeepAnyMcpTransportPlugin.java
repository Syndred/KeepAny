package io.github.syndred.keepany;

import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Registration alone does not bind a socket. Only an explicit foreground start can do so. */
@CapacitorPlugin(name="KeepAnyMcpTransport")
public final class KeepAnyMcpTransportPlugin extends Plugin {
    private final ExecutorService lifecycle=Executors.newSingleThreadExecutor();
    private final Set<String> stopped=new LinkedHashSet<>();
    private volatile McpHttpsServer active;
    private volatile boolean foreground=true,destroyed;
    private interface Action {void run() throws Exception;}
    private boolean fields(PluginCall call,String... keys){Set<String> expected=new HashSet<>(Arrays.asList(keys));Iterator<String> names=call.getData().keys();while(names.hasNext())if(!expected.remove(names.next()))return false;return expected.isEmpty();}
    private String string(PluginCall call,String key) throws Exception {Object value=call.getData().get(key);if(!(value instanceof String))throw new McpHttpsServer.Failure();return (String)value;}
    private void reject(PluginCall call,Exception failure){String code=failure instanceof McpHttpsServer.Failure?failure.getMessage():"mcp-transport-failed";if(!Arrays.asList("mcp-transport-failed","mcp-transport-active","mcp-transport-stale").contains(code))code="mcp-transport-failed";call.reject(code,code);}
    private void run(PluginCall call,Action action){try{action.run();}catch(Exception failure){reject(call,failure);}}
    private void serial(PluginCall call,Action action){try{lifecycle.execute(()->run(call,action));}catch(Exception failure){reject(call,failure);}}
    private McpHttpsServer server(PluginCall call) throws Exception {
        String id=string(call,"instanceId");McpHttpsServer server=active;if(server==null||!server.instanceId.equals(id))throw new McpHttpsServer.Failure("mcp-transport-stale");return server;
    }
    private void event(String name,String instance,String request){JSObject value=new JSObject();value.put("instanceId",instance);if(request!=null)value.put("requestId",request);notifyListeners(name,value,false);}
    private void rememberStopped(String id){synchronized(stopped){if(stopped.size()>=16)stopped.remove(stopped.iterator().next());stopped.add(id);}}
    private void stopActive(){McpHttpsServer server=active;active=null;if(server!=null){server.close();rememberStopped(server.instanceId);}}
    private McpHttpsServer.Events events(){return new McpHttpsServer.Events(){
        public void request(McpHttpsServer.Request request){
            if(!hasListeners("mcpRequest")){McpHttpsServer server=active;if(server!=null&&server.instanceId.equals(request.instanceId))try{server.cancel(request.requestId);}catch(Exception ignored){}return;}
            JSObject value=new JSObject();value.put("instanceId",request.instanceId);value.put("requestId",request.requestId);value.put("method",request.method);value.put("path",request.path);value.put("host",request.host);value.put("body",request.body);JSObject headers=new JSObject();for(Map.Entry<String,String> entry:request.headers.entrySet())headers.put(entry.getKey(),entry.getValue());value.put("headers",headers);notifyListeners("mcpRequest",value,false);
        }
        public void cancelled(String instance,String request){event("mcpCancelled",instance,request);}
        public void stopped(String instance){rememberStopped(instance);event("mcpStopped",instance,null);}
    };}
    @PluginMethod public void start(PluginCall call){if(!fields(call,"address")){reject(call,new McpHttpsServer.Failure());return;}serial(call,()->{
        if(active!=null)throw new McpHttpsServer.Failure("mcp-transport-active");if(destroyed||!foreground)throw new McpHttpsServer.Failure();
        McpHttpsServer server=McpHttpsServer.start(string(call,"address"),events(),()->foreground&&!destroyed);
        if(destroyed||!foreground){server.close();throw new McpHttpsServer.Failure();}active=server;
        try {JSObject value=new JSObject();value.put("instanceId",server.instanceId);value.put("endpoint",server.endpoint());value.put("certificatePem",server.certificatePem());value.put("spkiSha256",server.spkiSha256());call.resolve(value);}
        catch(Exception failedAcknowledgement){stopActive();throw new McpHttpsServer.Failure();}
    });}
    @PluginMethod public void reset(PluginCall call){if(!fields(call)){reject(call,new McpHttpsServer.Failure());return;}serial(call,()->{stopActive();call.resolve();});}
    @PluginMethod public void stop(PluginCall call){if(!fields(call,"instanceId")){reject(call,new McpHttpsServer.Failure());return;}serial(call,()->{
        String id=string(call,"instanceId");McpHttpsServer server=active;
        if(server!=null&&server.instanceId.equals(id)){stopActive();call.resolve();return;}
        synchronized(stopped){if(stopped.contains(id)){call.resolve();return;}}throw new McpHttpsServer.Failure("mcp-transport-stale");
    });}
    @PluginMethod public void cancel(PluginCall call){if(!fields(call,"instanceId","requestId")){reject(call,new McpHttpsServer.Failure());return;}run(call,()->{server(call).cancel(string(call,"requestId"));call.resolve();});}
    private Map<String,String> headers(PluginCall call) throws Exception {Object raw=call.getData().get("headers");if(!(raw instanceof JSONObject))throw new McpHttpsServer.Failure();JSONObject object=(JSONObject)raw;Map<String,String> result=new LinkedHashMap<>();Iterator<String> keys=object.keys();while(keys.hasNext()){String key=keys.next();Object value=object.get(key);if(!(value instanceof String))throw new McpHttpsServer.Failure();result.put(key,(String)value);}return result;}
    @PluginMethod public void responseStart(PluginCall call){if(!fields(call,"instanceId","requestId","status","headers")){reject(call,new McpHttpsServer.Failure());return;}run(call,()->{Object raw=call.getData().get("status");if(!(raw instanceof Number)||((Number)raw).doubleValue()!=((Number)raw).intValue())throw new McpHttpsServer.Failure();server(call).responseStart(string(call,"requestId"),((Number)raw).intValue(),headers(call));call.resolve();});}
    @PluginMethod public void responseWrite(PluginCall call){if(!fields(call,"instanceId","requestId","chunkBase64")){reject(call,new McpHttpsServer.Failure());return;}run(call,()->{String text=string(call,"chunkBase64");if(text.length()>4*((McpHttpsServer.CHUNK_LIMIT+2)/3)||text.length()%4!=0||!text.matches("[A-Za-z0-9+/]*={0,2}"))throw new McpHttpsServer.Failure();byte[] chunk=Base64.decode(text,Base64.NO_WRAP);server(call).responseWrite(string(call,"requestId"),chunk);call.resolve();});}
    @PluginMethod public void responseEnd(PluginCall call){if(!fields(call,"instanceId","requestId")){reject(call,new McpHttpsServer.Failure());return;}run(call,()->{server(call).responseEnd(string(call,"requestId")).whenComplete((ignored,failure)->{if(failure==null)call.resolve();else reject(call,new McpHttpsServer.Failure());});});}
    @Override protected void handleOnPause(){foreground=false;try{lifecycle.execute(this::stopActive);}catch(Exception ignored){}super.handleOnPause();}
    @Override protected void handleOnResume(){foreground=true;super.handleOnResume();}
    @Override protected void handleOnDestroy(){destroyed=true;foreground=false;try{lifecycle.execute(()->{stopActive();lifecycle.shutdown();});}catch(Exception ignored){}super.handleOnDestroy();}
}
