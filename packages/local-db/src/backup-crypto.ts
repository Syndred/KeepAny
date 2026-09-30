// Web Crypto standard primitives; versioned PBKDF2/AES-GCM encrypted backup container.
const magic=new TextEncoder().encode('KEEPANY1');
// Eight magic bytes, a 16-byte salt, a 12-byte IV and the 16-byte AES-GCM tag.
const headerBytes=36;
const tagBytes=16;
export const BACKUP_ARCHIVE_MAX_BYTES=100*1024*1024;
export const BACKUP_CONTAINER_MAX_BYTES=BACKUP_ARCHIVE_MAX_BYTES+headerBytes+tagBytes;
async function key(password:string,salt:Uint8Array,usage:KeyUsage[]){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt as BufferSource,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,usage);}
export async function encryptBackup(bytes:Uint8Array,password:string){if(bytes.length>BACKUP_ARCHIVE_MAX_BYTES)throw Error('backup-size');if(password.length<12)throw Error('password');const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:magic},await key(password,salt,['encrypt']),bytes as BufferSource));const result=new Uint8Array(headerBytes+ciphertext.length);result.set(magic);result.set(salt,8);result.set(iv,24);result.set(ciphertext,headerBytes);return result;}
export async function decryptBackup(bytes:Uint8Array,password:string){if(bytes.length>BACKUP_CONTAINER_MAX_BYTES)throw Error('backup-size');if(bytes.length<headerBytes+tagBytes||!magic.every((b,i)=>bytes[i]===b))throw Error('format');return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(24,headerBytes),additionalData:magic},await key(password,bytes.slice(8,24),['decrypt']),bytes.slice(headerBytes)));}
