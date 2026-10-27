package io.github.syndred.keepany;

import static org.junit.Assert.*;
import com.getcapacitor.*;
import java.lang.reflect.Field;
import java.net.*;
import java.util.concurrent.*;
import org.junit.*;

/** Real plugin lifecycle queue with captured JS acknowledgements, no Android device claim. */
public class McpTransportPluginTest {
    private KeepAnyMcpTransportPlugin plugin;
    static class Call extends PluginCall {
        final CompletableFuture<JSObject> result=new CompletableFuture<>();
        Call(JSObject data){super(null,"KeepAnyMcpTransport","synthetic-call","test",data);}
        @Override public void resolve(){result.complete(new JSObject());}
        @Override public void resolve(JSObject value){result.complete(value);}
        @Override public void reject(String message,String code){result.completeExceptionally(new Exception(code));}
        JSObject value() throws Exception{return result.get(5,TimeUnit.SECONDS);}
        String failure() throws Exception{try{value();fail("should reject");return "";}catch(ExecutionException expected){return expected.getCause().getMessage();}}
    }
    @Before public void setup(){plugin=new KeepAnyMcpTransportPlugin();}
    @After public void finish() throws Exception {plugin.handleOnDestroy();Field field=KeepAnyMcpTransportPlugin.class.getDeclaredField("lifecycle");field.setAccessible(true);assertTrue(((ExecutorService)field.get(plugin)).awaitTermination(5,TimeUnit.SECONDS));}
    private Call start(){Call call=new Call(new JSObject().put("address","127.0.0.1"));plugin.start(call);return call;}
    private void closed(String endpoint) throws Exception{int port=new URI(endpoint).getPort();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);do{try(Socket socket=new Socket(Proxy.NO_PROXY)){socket.connect(new InetSocketAddress("127.0.0.1",port),500);}catch(ConnectException expected){return;}Thread.sleep(20);}while(System.nanoTime()<deadline);fail("old listener remains open: "+endpoint);}
    @Test public void resetQueuedDuringStartStopsOldBeforeNextStartAndStaleStopCannotTouchNew() throws Exception {
        Call first=start(),reset=new Call(new JSObject());plugin.reset(reset);Call second=start();JSObject old=first.value();reset.value();JSObject current=second.value();
        assertNotEquals(old.getString("instanceId"),current.getString("instanceId"));closed(old.getString("endpoint"));
        Call oldStop=new Call(new JSObject().put("instanceId",old.getString("instanceId")));plugin.stop(oldStop);oldStop.value();
        Call wrongStop=new Call(new JSObject().put("instanceId","00000000-0000-4000-8000-000000000000"));plugin.stop(wrongStop);assertEquals("mcp-transport-stale",wrongStop.failure());
        Call duplicate=start();assertEquals("mcp-transport-active",duplicate.failure());
        Call stop=new Call(new JSObject().put("instanceId",current.getString("instanceId")));plugin.stop(stop);stop.value();closed(current.getString("endpoint"));
        Call again=new Call(new JSObject().put("instanceId",current.getString("instanceId")));plugin.stop(again);again.value();
    }
    @Test public void strictUnknownBridgeFieldsAndPauseNeverAutoRestarts() throws Exception {
        Call invalid=new Call(new JSObject().put("address","127.0.0.1").put("trustAll",true));plugin.start(invalid);assertEquals("mcp-transport-failed",invalid.failure());
        JSObject info=start().value();Call resetExtra=new Call(new JSObject().put("instanceId",info.getString("instanceId")));plugin.reset(resetExtra);assertEquals("mcp-transport-failed",resetExtra.failure());
        plugin.handleOnPause();Call barrier=new Call(new JSObject());plugin.reset(barrier);barrier.value();closed(info.getString("endpoint"));
        assertEquals("mcp-transport-failed",start().failure());plugin.handleOnResume();closed(info.getString("endpoint"));JSObject fresh=start().value();assertNotEquals(info.getString("instanceId"),fresh.getString("instanceId"));
        Call badResponse=new Call(new JSObject().put("instanceId",fresh.getString("instanceId")).put("requestId","00000000-0000-4000-8000-000000000000").put("status",200).put("headers",new JSObject()).put("extra","no"));plugin.responseStart(badResponse);assertEquals("mcp-transport-failed",badResponse.failure());
    }
    @Test public void failedStartAcknowledgementClosesListenerAndQueueCanRetry() throws Exception {
        final String[] endpoint={null};Call broken=new Call(new JSObject().put("address","127.0.0.1")){
            @Override public void resolve(JSObject value){endpoint[0]=value.getString("endpoint");throw new IllegalStateException("synthetic acknowledgement failure");}
        };plugin.start(broken);assertEquals("mcp-transport-failed",broken.failure());assertNotNull(endpoint[0]);closed(endpoint[0]);assertNotNull(start().value().getString("instanceId"));
    }
}
