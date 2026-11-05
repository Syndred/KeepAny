package io.github.syndred.keepany;

import java.io.*;
import java.net.Proxy;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;

/** Explicitly configured AI POST only. Memory-only; no cookie jar, credential persistence or logging. */
final class ConnectionsHttp implements AutoCloseable {
    static final int AI_INPUT_LIMIT=16*1024*1024, AI_OUTPUT_LIMIT=8*1024*1024;
    private static final Set<String> AI_PROVIDERS=new HashSet<>(Arrays.asList("openai","anthropic","google","deepseek","qwen","doubao","moonshot","minimax","openrouter","ollama","compatible"));
    private static final Set<String> AI_HEADERS=new HashSet<>(Arrays.asList("accept","content-type","user-agent","authorization","x-api-key","x-goog-api-key","anthropic-version","anthropic-beta","openai-organization","openai-project","http-referer","x-title","x-openrouter-title"));
    static final class AiTimeout extends IOException { AiTimeout(){super("native-ai-timeout");} }
    static String aiFailureCode(Throwable error){return error instanceof AiTimeout||error instanceof java.net.SocketTimeoutException?"TIMEOUT":"native-ai-failed";}
    private static final class SecretBuffer extends ByteArrayOutputStream { void clear(){Arrays.fill(buf,(byte)0);reset();} }
    private static final class AiTransfer {
        final String id; final HttpUrl url; final Map<String,String> headers; final long deadline;
        final SecretBuffer input=new SecretBuffer(); byte[] received; Call call; ScheduledFuture<?> expiry; boolean sealed,closed;
        AiTransfer(String id,HttpUrl url,Map<String,String> headers,int timeout){this.id=id;this.url=url;this.headers=new HashMap<>(headers);deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeout);}
        void clear(){input.clear();if(received!=null)Arrays.fill(received,(byte)0);received=null;headers.clear();if(expiry!=null){expiry.cancel(false);expiry=null;}}
    }
    private AiTransfer ai;
    private String aiExpiredId;
    private final Map<String,Long> aiCancelled=new HashMap<>();
    private final ScheduledThreadPoolExecutor aiClock=new ScheduledThreadPoolExecutor(1,task->{Thread worker=new Thread(task,"KeepAny-AI-deadline");worker.setDaemon(true);return worker;});
    static final int CHUNK = 256 * 1024;
    static final class Failure extends IOException { Failure() { super("native-ai-failed"); } }
    interface ClientFactory { OkHttpClient create(CookieJar cookies); }
    static final class Result {
        final int status; final long size; final Map<String,String> headers; final byte[] body;
        Result(int status, long size, Map<String,String> headers, byte[] body) { this.status=status;this.size=size;this.headers=headers;this.body=body; }
    }
    private final ClientFactory clients;
    ConnectionsHttp() { this(ConnectionsHttp::client); }
    ConnectionsHttp(ClientFactory clients) { this.clients=clients;aiClock.setRemoveOnCancelPolicy(true); }
    static OkHttpClient client(CookieJar cookies) {
        return new OkHttpClient.Builder().cookieJar(cookies).cache(null).proxy(Proxy.NO_PROXY)
            .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(8,TimeUnit.SECONDS).callTimeout(30,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).writeTimeout(30,TimeUnit.SECONDS).build();
    }
    static String origin(HttpUrl url) { String base=url.newBuilder().encodedPath("/").query(null).fragment(null).build().toString();return base.substring(0,base.length()-1); }
    static HttpUrl aiTarget(String provider,String base,String model) throws Failure {
        HttpUrl url=base==null?null:HttpUrl.parse(base);
        if(!AI_PROVIDERS.contains(provider)||url==null||base.length()>2048||!url.username().isEmpty()||!url.password().isEmpty()||url.query()!=null||url.fragment()!=null||model==null||model.trim().isEmpty()||model.length()>200||
            !url.isHttps()&&!(url.scheme().equals("http")&&Arrays.asList("localhost","127.0.0.1","::1").contains(url.host())))throw new Failure();
        String value=url.toString().replaceAll("/+$","");
        if(provider.equals("anthropic")||provider.equals("minimax"))value+="/messages";
        else if(provider.equals("google")) {
            String path=model.contains("/")?model:"models/"+model;
            if(!path.matches("[A-Za-z0-9_./-]+")||Arrays.stream(path.split("/",-1)).anyMatch(part->part.isEmpty()||part.equals(".")||part.equals("..")))throw new Failure();
            value+="/"+path+":generateContent";
        } else {if(value.endsWith("/chat/completions"))value=value.substring(0,value.length()-"/chat/completions".length());value+="/chat/completions";}
        HttpUrl endpoint=HttpUrl.parse(value);if(endpoint==null||!origin(endpoint).equals(origin(url)))throw new Failure();return endpoint;
    }
    synchronized void aiOpen(String id,String provider,String base,String model,Map<String,String> headers,int timeout) throws IOException {
        aiId(id);if(ai!=null||timeout<1||timeout>120000)throw new Failure();
        HttpUrl url=aiTarget(provider,base,model);int total=0;
        for(Map.Entry<String,String> header:headers.entrySet()) {
            String name=header.getKey(),value=header.getValue();total+=(name+value).getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
            if(!AI_HEADERS.contains(name)||value.length()>16384||value.matches("(?s).*[\\r\\n\\x00].*")||total>65536)throw new Failure();
        }
        if(!headers.getOrDefault("content-type","").toLowerCase(Locale.ROOT).matches("application/json(?:\\s*;.*)?"))throw new Failure();
        if(id.equals(aiExpiredId))aiExpiredId=null;
        AiTransfer entry=new AiTransfer(id,url,headers,timeout);ai=entry;
        entry.expiry=aiClock.schedule(()->expireAi(entry),timeout,TimeUnit.MILLISECONDS);
    }
    private synchronized AiTransfer aiLive(String id) throws IOException {
        if(id!=null&&id.equals(aiExpiredId))throw new AiTimeout();aiId(id);if(ai==null||!ai.id.equals(id)||ai.closed)throw new Failure();if(System.nanoTime()>=ai.deadline)throw new AiTimeout();return ai;
    }
    private synchronized void aiId(String id) throws Failure {checkedId(id);long now=System.currentTimeMillis();aiCancelled.values().removeIf(deadline->deadline<now);if(aiCancelled.containsKey(id))throw new Failure();}
    private void expireAi(AiTransfer entry) {
        Call pending;synchronized(this){if(ai!=entry)return;aiExpiredId=entry.id;aiCancelled.put(entry.id,System.currentTimeMillis()+120000);entry.closed=true;pending=entry.call;entry.clear();if(pending==null)ai=null;}
        if(pending!=null)pending.cancel();
    }
    synchronized void aiWrite(String id,byte[] bytes) throws IOException {
        AiTransfer transfer=aiLive(id);if(transfer.sealed||bytes.length==0||bytes.length>CHUNK||transfer.input.size()+bytes.length>AI_INPUT_LIMIT)throw new Failure();transfer.input.write(bytes);
    }
    Result aiRequest(String id) throws IOException {
        AiTransfer transfer;byte[] bytes;OkHttpClient client;Call call;
        synchronized(this) {
            transfer=aiLive(id);if(transfer.sealed||transfer.input.size()==0)throw new Failure();transfer.sealed=true;
            bytes=transfer.input.toByteArray();transfer.input.clear();
            Request.Builder request=new Request.Builder().url(transfer.url);for(Map.Entry<String,String> entry:transfer.headers.entrySet())request.header(entry.getKey(),entry.getValue());
            long remaining=Math.max(1,TimeUnit.NANOSECONDS.toMillis(transfer.deadline-System.nanoTime()));
            client=clients.create(CookieJar.NO_COOKIES).newBuilder().callTimeout(remaining,TimeUnit.MILLISECONDS).readTimeout(remaining,TimeUnit.MILLISECONDS).writeTimeout(remaining,TimeUnit.MILLISECONDS).build();
            call=client.newCall(request.post(RequestBody.create(bytes,MediaType.get("application/json"))).build());transfer.call=call;
        }
        SecretBuffer output=new SecretBuffer();boolean success=false;
        try(Response response=aiExecute(id,call)) {
            if(response.code()<200||response.code()>599||response.code()>=300&&response.code()<400||!response.request().url().equals(transfer.url))throw new Failure();
            ResponseBody body=response.body();if(body==null||body.contentLength()>AI_OUTPUT_LIMIT)throw new Failure();
            byte[] buffer=new byte[8192];try(InputStream input=body.byteStream()) {int count;while((count=input.read(buffer))!=-1){aiLive(id);if(output.size()+count>AI_OUTPUT_LIMIT)throw new Failure();output.write(buffer,0,count);}}finally{Arrays.fill(buffer,(byte)0);}
            synchronized(this){aiLive(id);transfer.received=output.toByteArray();success=true;return new Result(response.code(),transfer.received.length,responseHeaders(response),null);}
        } catch(IOException error) {if(System.nanoTime()>=transfer.deadline)throw new AiTimeout();throw error;}
        finally {Arrays.fill(bytes,(byte)0);output.clear();synchronized(this){transfer.call=null;transfer.headers.clear();if(!success||transfer.closed){transfer.clear();if(ai==transfer)ai=null;}}client.connectionPool().evictAll();}
    }
    private Response aiExecute(String id,Call call) throws IOException {aiLive(id);return call.execute();}
    synchronized byte[] aiRead(String id,long offset) throws IOException {
        AiTransfer transfer=aiLive(id);if(transfer.received==null||offset<0||offset>=transfer.received.length)throw new Failure();return Arrays.copyOfRange(transfer.received,(int)offset,(int)Math.min(transfer.received.length,offset+CHUNK));
    }
    void aiCancel(String id) {
        Call pending=null;synchronized(this){if(id==null)return;if(id.equals(aiExpiredId))aiExpiredId=null;aiCancelled.put(id,System.currentTimeMillis()+120000);if(ai!=null&&ai.id.equals(id)){ai.closed=true;pending=ai.call;ai.clear();if(pending==null)ai=null;}}
        if(pending!=null)pending.cancel();
    }
    private void checkedId(String id) throws Failure { if(id==null||!id.matches("[0-9a-fA-F-]{36}")) throw new Failure(); }
    private static Map<String,String> responseHeaders(Response response) {
        Map<String,String> result=new HashMap<>();for(String name:Arrays.asList("content-type","content-length")) {
            String value=response.header(name);if(value!=null&&value.length()<1024)result.put(name,value);
        }return result;
    }
    public synchronized void close() {if(ai!=null)aiCancel(ai.id);aiClock.shutdownNow();aiCancelled.clear();aiExpiredId=null;}
}
