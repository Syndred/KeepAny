package io.github.syndred.keepany;

import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.*;

/** Metadata-only schema and standard AES-GCM framing. No application field values. */
final class McpAuthorityCodec {
    static final int MAX_STATE=2*1024*1024, MAX_ENVELOPE=MAX_STATE+4096;
    static final String EMPTY="{\"grants\":[],\"previews\":[],\"operations\":[],\"audit\":[]}";
    private static final byte[] MAGIC=new byte[]{'K','M','A','1'};
    private static final Set<String> READ=new HashSet<>(Arrays.asList("kind","name","category","tags","description","url","status","dueDate"));
    private static final Set<String> WRITE=new HashSet<>(Arrays.asList("name","category","tags","description","url"));
    static final class Failure extends Exception { Failure(){super("mcp-native-unavailable");} }
    static final class Snapshot {final String revision,payload;Snapshot(String revision,String payload){this.revision=revision;this.payload=payload;}}
    static void scope(String value) throws Failure {if(value==null||!value.matches("[a-f0-9]{64}"))throw new Failure();}
    private static byte[] utf8(String value) throws Exception {
        ByteBuffer bytes=StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(value));
        byte[] result=new byte[bytes.remaining()];bytes.get(result);return result;
    }
    private static String text(byte[] value) throws Exception {return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value)).toString();}
    private static JSONObject object(String value,int limit) throws Exception {
        if(value==null||value.length()>limit||utf8(value).length>limit)throw new Failure();
        // Bound nesting before handing text to the platform JSON parser.
        int depth=0;boolean quoted=false,escape=false;
        for(int i=0;i<value.length();i++){char ch=value.charAt(i);if(quoted){if(escape)escape=false;else if(ch=='\\')escape=true;else if(ch=='"')quoted=false;}else if(ch=='"')quoted=true;else if(ch=='{'||ch=='['){if(++depth>8)throw new Failure();}else if(ch=='}'||ch==']'){if(--depth<0)throw new Failure();}}
        if(quoted||depth!=0)throw new Failure();JSONTokener parser=new JSONTokener(value);Object parsed=parser.nextValue();if(!(parsed instanceof JSONObject)||parser.nextClean()!=0)throw new Failure();return (JSONObject)parsed;
    }
    private static void fields(JSONObject row,String required,String optional) throws Exception {
        Set<String> must=new HashSet<>(Arrays.asList(required.split(","))),allowed=new HashSet<>(must);if(!optional.isEmpty())allowed.addAll(Arrays.asList(optional.split(",")));
        Iterator<String> keys=row.keys();while(keys.hasNext()){String key=keys.next();if(!allowed.contains(key)||row.isNull(key))throw new Failure();must.remove(key);}if(!must.isEmpty())throw new Failure();
    }
    private static String string(JSONObject row,String key,String pattern) throws Exception {Object value=row.get(key);if(!(value instanceof String)||!((String)value).matches(pattern))throw new Failure();return (String)value;}
    private static String uuid(JSONObject row,String key) throws Exception {return string(row,key,"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");}
    private static String id(JSONObject row,String key) throws Exception {return string(row,key,"[A-Za-z0-9_-]{1,96}");}
    private static String op(JSONObject row,String key) throws Exception {return string(row,key,"[A-Za-z0-9_-]{8,96}");}
    private static void hash(JSONObject row,String key) throws Exception {string(row,key,"[a-f0-9]{64}");}
    private static double stamp(JSONObject row,String key) throws Exception {Object raw=row.get(key);if(!(raw instanceof Number))throw new Failure();double value=((Number)raw).doubleValue();if(!Double.isFinite(value)||value<0||value>9007199254740991d||value!=Math.rint(value))throw new Failure();return value;}
    private static JSONArray array(JSONObject row,String key,int min,int max) throws Exception {Object value=row.get(key);if(!(value instanceof JSONArray)||((JSONArray)value).length()<min||((JSONArray)value).length()>max)throw new Failure();return (JSONArray)value;}
    private static Set<String> strings(JSONObject row,String key,int min,int max,Set<String> allowed) throws Exception {
        JSONArray values=array(row,key,min,max);Set<String> seen=new HashSet<>();for(int i=0;i<values.length();i++){Object raw=values.get(i);if(!(raw instanceof String)||!seen.add((String)raw)||allowed!=null&&!allowed.contains(raw)||allowed==null&&!((String)raw).matches("[A-Za-z0-9_-]{1,96}"))throw new Failure();}return seen;
    }
    private static JSONObject row(JSONArray rows,int i) throws Exception {Object value=rows.get(i);if(!(value instanceof JSONObject))throw new Failure();return (JSONObject)value;}
    private static void unique(Set<String> seen,String value) throws Failure {if(!seen.add(value))throw new Failure();}
    static JSONObject state(String payload) throws Exception {
        JSONObject result=object(payload,MAX_STATE);fields(result,"grants,previews,operations,audit","");
        JSONArray grants=array(result,"grants",0,1024),previews=array(result,"previews",0,2048),operations=array(result,"operations",0,4096),audit=array(result,"audit",0,8192);
        Set<String> seen=new HashSet<>();
        for(int i=0;i<grants.length();i++){
            JSONObject grant=row(grants,i);fields(grant,"id,secretHash,assetIds,readFields,writeFields,createdAt,expiresAt","revokedAt");unique(seen,uuid(grant,"id"));hash(grant,"secretHash");strings(grant,"assetIds",1,500,null);
            Set<String> reads=strings(grant,"readFields",1,8,READ),writes=strings(grant,"writeFields",0,5,WRITE);if(!reads.containsAll(writes)||stamp(grant,"expiresAt")<=stamp(grant,"createdAt"))throw new Failure();if(grant.has("revokedAt"))stamp(grant,"revokedAt");
        }
        seen.clear();Set<String> requestSeen=new HashSet<>();
        for(int i=0;i<previews.length();i++){
            JSONObject preview=row(previews,i);fields(preview,"id,grantId,operationId,assetId,expectedVersion,patchHash,expiresAt","approvedAt,rejectedAt");unique(seen,uuid(preview,"id"));unique(requestSeen,uuid(preview,"grantId")+":"+op(preview,"operationId"));id(preview,"assetId");hash(preview,"expectedVersion");hash(preview,"patchHash");stamp(preview,"expiresAt");
            if(preview.has("approvedAt"))stamp(preview,"approvedAt");if(preview.has("rejectedAt"))stamp(preview,"rejectedAt");if(preview.has("approvedAt")&&preview.has("rejectedAt"))throw new Failure();
        }
        seen.clear();
        for(int i=0;i<operations.length();i++){
            JSONObject receipt=row(operations,i);fields(receipt,"operationId,grantId,previewId,patchHash,assetId,state,createdAt","completedAt");unique(seen,uuid(receipt,"grantId")+":"+op(receipt,"operationId"));uuid(receipt,"previewId");hash(receipt,"patchHash");id(receipt,"assetId");stamp(receipt,"createdAt");
            String status=string(receipt,"state","pending|applied");if(status.equals("pending")&&receipt.has("completedAt")||status.equals("applied")&&!receipt.has("completedAt"))throw new Failure();if(receipt.has("completedAt"))stamp(receipt,"completedAt");
        }
        seen.clear();
        for(int i=0;i<audit.length();i++){
            JSONObject entry=row(audit,i);fields(entry,"id,at,grantId,action,outcome","assetId,fieldNames,operationId");unique(seen,uuid(entry,"id"));uuid(entry,"grantId");stamp(entry,"at");string(entry,"action","list|get|preview|confirm|grant|revoke|approve|reject");string(entry,"outcome","allowed|denied|applied|duplicate|conflict");
            if(entry.has("assetId"))id(entry,"assetId");if(entry.has("operationId"))op(entry,"operationId");if(entry.has("fieldNames"))strings(entry,"fieldNames",0,8,READ);
        }
        return result;
    }
    static Snapshot snapshot(String revision,String payload) throws Exception {
        JSONObject frame=new JSONObject();frame.put("revision",revision);uuid(frame,"revision");return new Snapshot(revision,state(payload).toString());
    }
    private static byte[] aad(String scope) throws Exception {scope(scope);return utf8("KeepAny/MCP/authority/v1/"+scope);}
    static byte[] seal(String scope,Snapshot state,SecretKey key) throws Exception {
        Snapshot checked=snapshot(state.revision,state.payload);JSONObject frame=new JSONObject();frame.put("revision",checked.revision);frame.put("payload",McpAuthorityCodec.state(checked.payload));byte[] plain=utf8(frame.toString());
        try {if(plain.length>MAX_ENVELOPE)throw new Failure();Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(aad(scope));byte[] nonce=cipher.getIV();if(nonce.length!=12)throw new Failure();byte[] encrypted=cipher.doFinal(plain);return ByteBuffer.allocate(16+encrypted.length).put(MAGIC).put(nonce).put(encrypted).array();}
        finally {Arrays.fill(plain,(byte)0);}
    }
    static Snapshot open(String scope,byte[] frame,SecretKey key) throws Exception {
        if(frame==null||frame.length<32||frame.length>MAX_ENVELOPE+32||!Arrays.equals(Arrays.copyOf(frame,4),MAGIC))throw new Failure();
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Arrays.copyOfRange(frame,4,16)));cipher.updateAAD(aad(scope));byte[] plain=cipher.doFinal(frame,16,frame.length-16);
        try {JSONObject payload=object(text(plain),MAX_ENVELOPE);fields(payload,"revision,payload","");Object state=payload.get("payload");if(!(state instanceof JSONObject))throw new Failure();return snapshot(uuid(payload,"revision"),state.toString());}
        finally {Arrays.fill(plain,(byte)0);}
    }
}
