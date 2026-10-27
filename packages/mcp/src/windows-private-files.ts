// Windows-only native backend, compiled in the system PowerShell process. Paths and
// payloads enter exclusively as JSON data, never as PowerShell/C# executable text.
// Kept outside the browser barrel; the launcher bundles this fixed source verbatim.
export const windowsPrivateFilesSource = String.raw`
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class KeepAnyPrivateFiles {
  const uint RC=0x20000, DEL=0x10000, RA=0x80, GR=0x80000000, GW=0x40000000;
  const uint REPARSE=0x00200000, BACKUP=0x02000000, DOC=0x04000000, AR=0x400, AD=0x10;
  const uint SR=1, SW=2, SD=4;
  [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
  [StructLayout(LayoutKind.Sequential)] struct INFO { public uint attrs; public System.Runtime.InteropServices.ComTypes.FILETIME created,accessed,written; public uint volume,high,low,links,indexHigh,indexLow; }
  [StructLayout(LayoutKind.Sequential)] struct DISPOSITION { [MarshalAs(UnmanagedType.U1)] public bool delete; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="CreateFileW")] static extern SafeFileHandle Open(string p,uint a,uint s,IntPtr security,uint d,uint f,IntPtr t);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true,EntryPoint="CreateFileW")] static extern SafeFileHandle Create(string p,uint a,uint s,ref SA security,uint d,uint f,IntPtr t);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectoryW(string p,ref SA sa);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out INFO i);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle h,int c,ref DISPOSITION i,uint size);
  [DllImport("kernel32.dll",SetLastError=true,EntryPoint="SetFileInformationByHandle")] static extern bool SetInformation(SafeFileHandle h,int c,IntPtr i,uint size);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformationW(string root,StringBuilder name,uint nameSize,out uint serial,out uint component,out uint flags,StringBuilder filesystem,uint filesystemSize);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string s,uint revision,out IntPtr descriptor,out uint size);
  [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityInfo(SafeFileHandle h,int type,uint info,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
  [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  static readonly string Sid=WindowsIdentity.GetCurrent().User.Value;
  static readonly string TokenOwner=WindowsIdentity.GetCurrent().Owner.Value;
  static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=33554432 };
  sealed class Lease : IDisposable {
    public List<SafeFileHandle> parents=new List<SafeFileHandle>();
    public FileStream file,temporary; public string path,temporaryPath; public bool transaction;
    public void Dispose() { try {if(temporary!=null){try{Delete(temporary);}finally{temporary.Dispose();}}} finally {if(file!=null)file.Dispose(); for(int i=parents.Count-1;i>=0;i--)parents[i].Dispose();} }
  }
  static readonly Dictionary<string,Lease> Leases=new Dictionary<string,Lease>();
  static Exception Error(string code) { return new InvalidOperationException(code); }
  static Exception Native() { int n=Marshal.GetLastWin32Error(); return Error(n==2||n==3?"ENOENT":n==80||n==183?"EEXIST":"native-file-"+n); }
  static string PathChecked(string path) {
    if(String.IsNullOrEmpty(path)||path.Length<3||!Char.IsLetter(path[0])||path[1]!=':'||(path[2]!='\\'&&path[2]!='/')||path.IndexOf(':',2)>=0||path.IndexOf('\0')>=0)throw Error("unsafe-path");
    string full=Path.GetFullPath(path);
    uint serial,component,flags;StringBuilder filesystem=new StringBuilder(64);
    if(!GetVolumeInformationW(Path.GetPathRoot(full),null,0,out serial,out component,out flags,filesystem,64)||filesystem.ToString()!="NTFS")throw Error("unsupported-filesystem");
    foreach(string part in full.Substring(3).Split('\\'))if(part.EndsWith(".")||part.EndsWith(" ")||part.IndexOfAny(new char[]{'*','?','<' ,'>' ,'|'})>=0)throw Error("unsafe-path");
    return full.Length==3?full:full.TrimEnd('\\');
  }
  static INFO Info(SafeFileHandle h) { INFO i;if(!GetFileInformationByHandle(h,out i))throw Native();return i; }
  static string Identity(INFO i) { return i.volume.ToString("X8")+":"+i.indexHigh.ToString("X8")+i.indexLow.ToString("X8"); }
  static RawSecurityDescriptor Security(SafeFileHandle h) {
    IntPtr owner,group,dacl,sacl,descriptor;uint result=GetSecurityInfo(h,1,5,out owner,out group,out dacl,out sacl,out descriptor);
    if(result!=0)throw Error("security-query-failed");
    try { byte[] b=new byte[GetSecurityDescriptorLength(descriptor)];Marshal.Copy(descriptor,b,0,b.Length);return new RawSecurityDescriptor(b,0); }
    finally { LocalFree(descriptor); }
  }
  static void Private(SafeFileHandle h) {
    RawSecurityDescriptor sd=Security(h);
    if(sd.Owner==null||sd.Owner.Value!=Sid||sd.DiscretionaryAcl==null||(sd.ControlFlags&ControlFlags.DiscretionaryAclProtected)==0)throw Error("unsafe-acl");
    bool owner=false;
    foreach(GenericAce raw in sd.DiscretionaryAcl) {
      CommonAce ace=raw as CommonAce;
      if(ace==null||ace.AceQualifier!=AceQualifier.AccessAllowed||ace.IsCallback||(ace.AceFlags&AceFlags.InheritOnly)!=0)throw Error("unsafe-acl");
      string sid=ace.SecurityIdentifier.Value;
      if(sid!=Sid&&sid!="S-1-5-18")throw Error("unsafe-acl");
      if(sid==Sid&&(ace.AccessMask&0x1F01FF)==0x1F01FF)owner=true;
    }
    if(!owner)throw Error("unsafe-acl");
  }
  static SA Descriptor(bool directory) {
    IntPtr p;uint size;string flags=directory?"OICI":"";
    if(!ConvertStringSecurityDescriptorToSecurityDescriptorW("O:"+Sid+"D:P(A;"+flags+";FA;;;"+Sid+")(A;"+flags+";FA;;;SY)",1,out p,out size))throw Native();
    return new SA { length=Marshal.SizeOf(typeof(SA)),descriptor=p,inherit=false };
  }
  static SafeFileHandle Checked(string p,uint access,bool directory,bool privateAcl,uint share) {
    SafeFileHandle h=Open(p,access|RC|RA,share,IntPtr.Zero,3,REPARSE|(directory?BACKUP:0),IntPtr.Zero);
    if(h.IsInvalid){h.Dispose();throw Native();}
    try { INFO i=Info(h);if((i.attrs&AR)!=0||((i.attrs&AD)!=0)!=directory||(!directory&&i.links!=1))throw Error("unsafe-file");if(privateAcl)Private(h);return h; }
    catch {h.Dispose();throw;}
  }
  // Open each ancestor with FILE_LIST_DIRECTORY and deny FILE_SHARE_DELETE.
  // Checking a path without these retained handles permits junction/rename races.
  static List<SafeFileHandle> Parents(string directory,bool privateLeaf) {
    List<SafeFileHandle> handles=new List<SafeFileHandle>();
    try {
      string full=PathChecked(directory),current=Path.GetPathRoot(full);
      handles.Add(Checked(current,1,true,full.Length==3&&privateLeaf,SR|SW));
      foreach(string part in full.Substring(current.Length).Split(new char[]{'\\'},StringSplitOptions.RemoveEmptyEntries)) {
        current=Path.Combine(current,part);handles.Add(Checked(current,1,true,privateLeaf&&String.Equals(current,full,StringComparison.OrdinalIgnoreCase),SR|SW));
      }
      return handles;
    } catch {foreach(SafeFileHandle h in handles)h.Dispose();throw;}
  }
  static void CloseParents(List<SafeFileHandle> handles) {for(int i=handles.Count-1;i>=0;i--)handles[i].Dispose();}
  static FileStream NewFile(string p,bool temporary) {
    SA sa=Descriptor(false);
    try {
      SafeFileHandle h=Create(p,GR|GW|DEL|RC|RA,SR|SD,ref sa,1,REPARSE|(temporary?DOC:0),IntPtr.Zero);
      if(h.IsInvalid){h.Dispose();throw Native();}
      try {Private(h);return new FileStream(h,FileAccess.ReadWrite);}catch{h.Dispose();throw;}
    }finally{LocalFree(sa.descriptor);}
  }
  static void Write(FileStream stream,string value) {byte[] b=Encoding.UTF8.GetBytes(value);stream.Write(b,0,b.Length);stream.Flush(true);}
  static string Read(string p,bool privateAcl,int limit) {
    using(SafeFileHandle h=Checked(p,GR,false,privateAcl,SR|SD)) {
      INFO i=Info(h);if(i.high!=0||i.low==0||i.low>limit)throw Error("unsafe-size");
      if(!privateAcl) {RawSecurityDescriptor sd=Security(h);if(sd.Owner==null||(sd.Owner.Value!=Sid&&sd.Owner.Value!=TokenOwner))throw Error("unsafe-owner");}
      using(FileStream f=new FileStream(h,FileAccess.Read))using(StreamReader reader=new StreamReader(f,new UTF8Encoding(false,true)))return reader.ReadToEnd();
    }
  }
  static string ReadState(string p) {try{return Read(p,true,8388608);}catch(InvalidOperationException e){if(e.Message=="ENOENT")return null;throw;}}
  static string Keep(Lease lease) {string token=Guid.NewGuid().ToString();Leases.Add(token,lease);return token;}
  static void Delete(FileStream file) {DISPOSITION d=new DISPOSITION {delete=true};if(!SetFileInformationByHandle(file.SafeFileHandle,4,ref d,1))throw Native();}
  static void RenameHandle(SafeFileHandle file,string destination,bool replace=true) {
    byte[] name=Encoding.Unicode.GetBytes(destination);int root=IntPtr.Size==8?8:4,length=root+IntPtr.Size,offset=length+4,size=offset+name.Length+2;
    IntPtr buffer=Marshal.AllocHGlobal(size);
    try {for(int i=0;i<size;i++)Marshal.WriteByte(buffer,i,0);Marshal.WriteInt32(buffer,0,replace?1:0);Marshal.WriteInt32(buffer,length,name.Length);Marshal.Copy(name,0,IntPtr.Add(buffer,offset),name.Length);if(!SetInformation(file,3,buffer,(uint)size))throw Native();}
    finally{Marshal.FreeHGlobal(buffer);}
  }
  static object Execute(Dictionary<string,object> request) {
    string op=(string)request["op"],path=request.ContainsKey("path")?PathChecked((string)request["path"]):null;
    if(op=="release") {
      string token=(string)request["token"];Lease lease;
      if(Leases.TryGetValue(token,out lease)) {
        Leases.Remove(token);
        try {
          if(lease.transaction) {
            // CREATE_NEW returns ACCESS_DENIED while a deleted lock still has
            // shared readers. Vacate its fixed name atomically using the held
            // identity before marking that exact completed lock for deletion.
            // The retained private parent chain covers this sibling, and a
            // collision fails without replacing any existing destination.
            RenameHandle(lease.file.SafeFileHandle,lease.path+".lock."+Guid.NewGuid().ToString()+".released",false);
            Delete(lease.file);
          }
        } finally {lease.Dispose();}
      }
      return true;
    }
    if(op=="prepare"||op=="commit") {
      Lease lease;if(!Leases.TryGetValue((string)request["token"],out lease)||!lease.transaction)throw Error("unknown-transaction");
      if(op=="prepare") {
        if(lease.temporary!=null)throw Error("transaction-already-prepared");
        string data=(string)request["data"];
        if(Encoding.UTF8.GetByteCount(data)>8388608)throw Error("authority-file-too-large");
        lease.temporaryPath=lease.path+"."+Guid.NewGuid().ToString()+".tmp";
        lease.temporary=NewFile(lease.temporaryPath,false);
        Write(lease.temporary,data);
        return new Dictionary<string,object>{{"path",lease.temporaryPath},{"identity",Identity(Info(lease.temporary.SafeFileHandle))}};
      }
      if(lease.temporary==null)throw Error("transaction-not-prepared");
      ReadState(lease.path);
      FileStream file=lease.temporary;string identity=Identity(Info(file.SafeFileHandle));
      RenameHandle(file.SafeFileHandle,lease.path);
      lease.temporary=null;
      try {file.Flush(true);using(SafeFileHandle target=Checked(lease.path,0,false,true,SR|SW|SD)){if(Identity(Info(target))!=identity)throw Error("committed-file-identity-changed");}}
      finally{file.Dispose();}
      return true;
    }
    if(op=="createDirectory") {
      List<SafeFileHandle> parents=Parents(Path.GetDirectoryName(path),false);
      try {SA sa=Descriptor(true);try{if(!CreateDirectoryW(path,ref sa)){int n=Marshal.GetLastWin32Error();if(n!=183)throw Native();}}finally{LocalFree(sa.descriptor);}using(SafeFileHandle h=Checked(path,1,true,true,SR|SW))return true;}
      finally{CloseParents(parents);}
    }
    if(op=="checkDirectory"||op=="holdDirectory") {
      List<SafeFileHandle> parents=Parents(path,true);
      if(op=="holdDirectory")return Keep(new Lease {parents=parents,path=path});
      CloseParents(parents);return true;
    }
    List<SafeFileHandle> chain=Parents(Path.GetDirectoryName(path),op!="readRequest");
    try {
      if(op=="readRequest")return Read(path,false,65536);
      if(op=="readState")return ReadState(path);
      if(op=="inspect") {using(SafeFileHandle h=Checked(path,0,false,true,SR|SW|SD))return Identity(Info(h));}
      if(op=="createFile"||op=="pairing") {
        FileStream file=NewFile(path,op=="pairing");
        bool kept=false;
        try {Write(file,(string)request["data"]);if(op=="pairing"){string token=Keep(new Lease {parents=chain,file=file,path=path});chain=null;kept=true;return token;}return Identity(Info(file.SafeFileHandle));}
        finally {if(!kept)file.Dispose();}
      }
      if(op=="begin") {
        FileStream file=NewFile(path+".lock",false);
        try {string data=ReadState(path);string token=Keep(new Lease {parents=chain,file=file,path=path,transaction=true});chain=null;return new Dictionary<string,object>{{"token",token},{"data",data}};}
        catch {try{Delete(file);}finally{file.Dispose();}throw;}
      }
      throw Error("unknown-operation");
    } finally {if(chain!=null)CloseParents(chain);}
  }
  public static void Run() {
    try {string line;while((line=Console.ReadLine())!=null){Dictionary<string,object> r=null;try{r=Json.Deserialize<Dictionary<string,object>>(line);object value=Execute(r);Console.WriteLine(Json.Serialize(new {id=r["id"],value=value}));}catch(Exception e){Console.WriteLine(Json.Serialize(new {id=r==null?null:r["id"],error=e is InvalidOperationException?e.Message:"native-operation-failed"}));}}}
    finally {foreach(Lease lease in Leases.Values)lease.Dispose();Leases.Clear();}
  }
}
`;
