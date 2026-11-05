package io.github.syndred.keepany;

import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

@CapacitorPlugin(name="KeepAnyConnections")
public final class KeepAnyConnectionsPlugin extends Plugin {
    private ConnectionsHttp http;
    private final ExecutorService workers=Executors.newFixedThreadPool(4);
    @Override public void load(){http=new ConnectionsHttp();}
    private boolean fields(PluginCall call,String... expected) {
        Set<String> names=new HashSet<>(Arrays.asList(expected));Iterator<String> found=call.getData().keys();while(found.hasNext())if(!names.remove(found.next()))return false;return names.isEmpty();
    }
    private Map<String,String> headers(PluginCall call) throws Exception {
        JSONObject value=call.getData().getJSONObject("headers");Map<String,String> result=new HashMap<>();Iterator<String> keys=value.keys();while(keys.hasNext()){String name=keys.next();Object text=value.get(name);if(!(text instanceof String))throw new Exception();result.put(name,(String)text);}return result;
    }
    private byte[] bytes(PluginCall call,int limit) throws Exception {
        Object value=call.getData().get("bodyBase64");if(!(value instanceof String))throw new Exception();String text=(String)value;
        if(text.length()>4*((limit+2)/3)||text.length()%4!=0||!text.matches("[A-Za-z0-9+/]*={0,2}"))throw new Exception();byte[] bytes=Base64.decode(text,Base64.NO_WRAP);if(bytes.length>limit)throw new Exception();return bytes;
    }
    private void reject(PluginCall call){call.reject("native-ai-failed","native-ai-failed");}
    private void rejectAi(PluginCall call,Exception error){String code=ConnectionsHttp.aiFailureCode(error);call.reject(code,code);}
    private JSObject result(ConnectionsHttp.Result value){JSObject result=new JSObject();result.put("status",value.status);result.put("size",value.size);JSObject headers=new JSObject();for(Map.Entry<String,String> entry:value.headers.entrySet())headers.put(entry.getKey(),entry.getValue());result.put("headers",headers);if(value.body!=null)result.put("bodyBase64",Base64.encodeToString(value.body,Base64.NO_WRAP));return result;}
    @PluginMethod public void aiOpen(PluginCall call){if(!fields(call,"requestId","provider","baseURL","model","headers","timeoutMs")){reject(call);return;}try{Integer timeout=call.getInt("timeoutMs");if(timeout==null)throw new Exception();http.aiOpen(call.getString("requestId"),call.getString("provider"),call.getString("baseURL"),call.getString("model"),headers(call),timeout);call.resolve();}catch(Exception error){rejectAi(call,error);}}
    @PluginMethod public void aiWrite(PluginCall call){if(!fields(call,"requestId","bodyBase64")){reject(call);return;}try{http.aiWrite(call.getString("requestId"),bytes(call,ConnectionsHttp.CHUNK));call.resolve();}catch(Exception error){rejectAi(call,error);}}
    @PluginMethod public void aiRequest(PluginCall call){if(!fields(call,"requestId")){reject(call);return;}workers.execute(()->{try{call.resolve(result(http.aiRequest(call.getString("requestId"))));}catch(Exception error){rejectAi(call,error);}});}
    @PluginMethod public void aiRead(PluginCall call){if(!fields(call,"requestId","offset")){reject(call);return;}try{Object offset=call.getData().get("offset");if(!(offset instanceof Number)||((Number)offset).doubleValue()!=((Number)offset).longValue())throw new Exception();JSObject value=new JSObject();value.put("bodyBase64",Base64.encodeToString(http.aiRead(call.getString("requestId"),((Number)offset).longValue()),Base64.NO_WRAP));call.resolve(value);}catch(Exception error){rejectAi(call,error);}}
    @PluginMethod public void aiCancel(PluginCall call){if(!fields(call,"requestId")){reject(call);return;}http.aiCancel(call.getString("requestId"));call.resolve();}
    @Override protected void handleOnDestroy(){http.close();workers.shutdownNow();super.handleOnDestroy();}
}
