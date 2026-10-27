package io.github.syndred.keepany;

import java.io.*;
import java.net.Proxy;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;

/** Explicit origins only. No WebView/system cookie jar, credential persistence or logging. */
final class ConnectionsHttp implements AutoCloseable {
    static final int BACKUP_LIMIT = 100 * 1024 * 1024 + 1024, CHUNK = 256 * 1024, JSON_LIMIT = 8 * 1024 * 1024;
    static final class Failure extends IOException { Failure() { super("native-connections-failed"); } }
    interface ClientFactory { OkHttpClient create(CookieJar cookies); }
    static final class Result {
        final int status; final long size; final Map<String,String> headers; final byte[] body;
        Result(int status, long size, Map<String,String> headers, byte[] body) { this.status=status;this.size=size;this.headers=headers;this.body=body; }
    }
    private static final class Session implements CookieJar {
        final String origin; final Map<String,Cookie> cookies = new HashMap<>(); volatile boolean closed;
        Session(String origin) { this.origin=origin; }
        public synchronized void saveFromResponse(HttpUrl url, List<Cookie> values) {
            if (closed) return;
            for(Cookie cookie: values) {
                String key=cookie.name()+"|"+cookie.domain()+"|"+cookie.path();
                if(cookie.expiresAt()<=System.currentTimeMillis()) cookies.remove(key); else cookies.put(key,cookie);
            }
            if(cookies.size()>256)cookies.clear();
        }
        public synchronized List<Cookie> loadForRequest(HttpUrl url) {
            if(closed) return Collections.emptyList();
            cookies.values().removeIf(cookie -> cookie.expiresAt()<=System.currentTimeMillis());
            List<Cookie> result=new ArrayList<>();for(Cookie cookie:cookies.values()) if(cookie.matches(url)) result.add(cookie);return result;
        }
        synchronized void close() {closed=true;cookies.clear();}
    }
    private final File root;
    private final ClientFactory clients;
    private final Map<String,Session> sessions = new HashMap<>();
    private final Map<String,File> files = new HashMap<>();
    private final Map<String,Call> calls = new HashMap<>();
    private final Map<String,Session> owners = new HashMap<>();
    private final Set<String> sealed = new HashSet<>();
    private final Map<String,Long> cancelled = new HashMap<>();
    ConnectionsHttp(File root) { this(root, ConnectionsHttp::client); }
    ConnectionsHttp(File root, ClientFactory clients) { this.root=root;this.clients=clients; }
    static OkHttpClient client(CookieJar cookies) {
        return new OkHttpClient.Builder().cookieJar(cookies).cache(null).proxy(Proxy.NO_PROXY)
            .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(8,TimeUnit.SECONDS).callTimeout(30,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).writeTimeout(30,TimeUnit.SECONDS).build();
    }
    static HttpUrl target(String value) throws Failure {
        HttpUrl url=HttpUrl.parse(value);
        if(url==null||!url.isHttps()||!url.username().isEmpty()||!url.password().isEmpty()||url.fragment()!=null||value.length()>8192) throw new Failure();
        return url;
    }
    static String origin(HttpUrl url) { String base=url.newBuilder().encodedPath("/").query(null).fragment(null).build().toString();return base.substring(0,base.length()-1); }
    static boolean syncRoute(String path,String method) {
        if(path.equals("/workspaces")) return method.equals("GET")||method.equals("POST");
        if(path.equals("/sync/devices")) return method.equals("GET");
        if(Arrays.asList("/sync/identity","/sync/preflight","/sync/push","/sync/pull").contains(path)) return method.equals("POST");
        if(path.matches("/workspaces/[0-9a-fA-F-]{36}/attachments/[0-9a-fA-F-]{36}")) return method.equals("GET")||method.equals("PUT");
        if(path.matches("/workspaces/[0-9a-fA-F-]{36}/key-envelopes(?:/[0-9a-fA-F-]{36}(?:/revoke)?)?"))
            return path.endsWith("/revoke")?method.equals("POST"):method.equals("GET")||method.equals("POST")&&path.endsWith("/key-envelopes");
        return false;
    }
    static boolean sessionRoute(String path,String method) {
        return path.equals("/api/auth/get-session")&&method.equals("GET") ||
            Arrays.asList("/api/auth/sign-in/email","/api/auth/sign-up/email","/api/auth/sign-out").contains(path)&&method.equals("POST") || syncRoute(path,method);
    }
    private void checkedId(String id) throws Failure { if(id==null||!id.matches("[0-9a-fA-F-]{36}")) throw new Failure(); }
    private synchronized void live(String id) throws Failure {
        checkedId(id);long now=System.currentTimeMillis();cancelled.values().removeIf(deadline->deadline<now);if(cancelled.containsKey(id))throw new Failure();
    }
    synchronized String openSession(String input) throws IOException {
        HttpUrl url=target(input);if(!input.equals(origin(url))||sessions.size()>=4)throw new Failure();
        for(Session session:sessions.values())if(session.origin.equals(input))throw new Failure();
        String id=UUID.randomUUID().toString();sessions.put(id,new Session(input));return id;
    }
    synchronized void closeSession(String id) {Session session=sessions.remove(id);if(session!=null){session.close();for(Map.Entry<String,Session> owner:owners.entrySet())if(owner.getValue()==session){Call call=calls.get(owner.getKey());if(call!=null)call.cancel();}}}
    private static Map<String,String> responseHeaders(Response response) {
        Map<String,String> result=new HashMap<>();for(String name:Arrays.asList("content-type","content-length")) {
            String value=response.header(name);if(value!=null&&value.length()<1024)result.put(name,value);
        }return result;
    }
    private static Request request(HttpUrl url,String method,Map<String,String> headers,byte[] bytes,File file,Session session) throws IOException {
        Request.Builder builder=new Request.Builder().url(url).header("Accept-Encoding","identity");
        Set<String> allowed=session==null?new HashSet<>(Arrays.asList("authorization","content-type")):new HashSet<>(Arrays.asList("accept","content-type","x-keepany-account-id","x-ciphertext-sha256"));
        for(Map.Entry<String,String> header:headers.entrySet()) {
            String name=header.getKey().toLowerCase(Locale.ROOT),value=header.getValue();
            if(!allowed.contains(name)||value.length()>16384||value.matches("(?s).*[\\r\\n\\x00].*"))throw new Failure();builder.header(name,value);
        }
        if(session!=null)builder.header("Origin",session.origin);
        RequestBody body=null;
        if(!method.equals("GET")) body=file!=null?RequestBody.create(file,MediaType.parse(headers.getOrDefault("content-type","application/octet-stream"))):RequestBody.create(bytes,MediaType.parse(headers.getOrDefault("content-type","application/json")));
        else if(bytes.length>0)throw new Failure();
        return builder.method(method,body).build();
    }
    private Result execute(String id,Request request,Session session,int limit,File output) throws IOException {
        live(id);OkHttpClient client=clients.create(session==null?CookieJar.NO_COOKIES:session);Call call=client.newCall(request);
        synchronized(this){live(id);if(calls.size()>=4||calls.containsKey(id)||session!=null&&session.closed)throw new Failure();calls.put(id,call);if(session!=null)owners.put(id,session);}
        try(Response response=call.execute()) {
            if(response.code()<200||response.code()>=600||response.code()>=300&&response.code()<400||!response.request().url().equals(request.url()))throw new Failure();
            ResponseBody body=response.body();if(body==null||body.contentLength()>limit)throw new Failure();
            long total=0;ByteArrayOutputStream bytes=output==null?new ByteArrayOutputStream():null;
            try(InputStream input=body.byteStream();OutputStream sink=output==null?bytes:new FileOutputStream(output)) {
                byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){live(id);total+=count;if(total>limit)throw new Failure();sink.write(buffer,0,count);}
            }
            live(id);return new Result(response.code(),total,responseHeaders(response),bytes==null?null:bytes.toByteArray());
        } finally { synchronized(this){calls.remove(id);owners.remove(id);}client.connectionPool().evictAll(); }
    }
    Result sessionRequest(String id,String sessionId,String input,String method,Map<String,String> headers,byte[] bytes) throws IOException {
        Session session;synchronized(this){session=sessions.get(sessionId);}if(session==null||session.closed)throw new Failure();
        HttpUrl url=target(input);int limit=url.encodedPath().contains("/attachments/")?4*1024*1024:JSON_LIMIT;
        if(!origin(url).equals(session.origin)||url.query()!=null||!sessionRoute(url.encodedPath(),method)||bytes.length>limit)throw new Failure();
        Result result=execute(id,request(url,method,headers,bytes,null,session),session,limit,null);if(session.closed)throw new Failure();return result;
    }
    private synchronized File transfer(String id) throws IOException {
        live(id);File file=files.get(id);if(file!=null)return file;
        if(files.size()>=2||!root.isDirectory()&&!root.mkdirs())throw new Failure();
        file=new File(root,"transfer-"+id+".bin");if(!file.createNewFile())throw new Failure();files.put(id,file);return file;
    }
    synchronized void backupWrite(String id,byte[] bytes) throws IOException {
        if(bytes.length==0||bytes.length>CHUNK||sealed.contains(id))throw new Failure();File file=transfer(id);if(file.length()+bytes.length>BACKUP_LIMIT)throw new Failure();
        try(FileOutputStream out=new FileOutputStream(file,true)){out.write(bytes);}
    }
    Result backupRequest(String id,String input,String method,Map<String,String> headers) throws IOException {
        HttpUrl url=target(input);String host=url.host();
        if(!Arrays.asList("GET","PUT").contains(method)||!host.contains(".")||host.matches("[0-9.]+")||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal"))throw new Failure();
        File file=transfer(id);
        synchronized(this){if(sealed.contains(id))throw new Failure();sealed.add(id);}
        if(method.equals("PUT")) {
            if(file.length()==0||file.length()>BACKUP_LIMIT)throw new Failure();
            return execute(id,request(url,method,headers,new byte[0],file,null),null,8192,null);
        }
        return execute(id,request(url,method,headers,new byte[0],null,null),null,BACKUP_LIMIT,file);
    }
    synchronized byte[] backupRead(String id,long offset) throws IOException {
        live(id);File file=files.get(id);if(file==null||offset<0||offset>=file.length()||calls.containsKey(id))throw new Failure();
        try(RandomAccessFile input=new RandomAccessFile(file,"r")){input.seek(offset);byte[] result=new byte[(int)Math.min(CHUNK,file.length()-offset)];input.readFully(result);return result;}
    }
    synchronized void cancel(String id) {
        if(id==null)return;cancelled.put(id,System.currentTimeMillis()+120000);sealed.remove(id);Call call=calls.get(id);if(call!=null)call.cancel();File file=files.remove(id);if(file!=null)file.delete();
    }
    public synchronized void close() {for(Session session:sessions.values())session.close();sessions.clear();for(String id:new ArrayList<>(files.keySet()))cancel(id);for(Call call:calls.values())call.cancel();}
}
