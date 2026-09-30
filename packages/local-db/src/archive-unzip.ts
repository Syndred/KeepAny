import { Unzip, UnzipInflate, unzipSync, type UnzipFileInfo } from 'fflate';
import { BACKUP_ARCHIVE_MAX_BYTES } from './backup-crypto';

const expandedLimit = 300 * 1024 * 1024;
const entryLimit = 10003; // Manifest + records + intake reviews + 10,000 attachments.
const safePath = /^(?:manifest\.json|records\.json|intake-review\.json|files\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

/** Use fflate's metadata filter without decoding, then count actual streaming output. */
export function unzipArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > BACKUP_ARCHIVE_MAX_BYTES) throw Error('archive-size');
  const declared = new Map<string, UnzipFileInfo>();
  let declaredTotal = 0;
  unzipSync(bytes, { filter: file => {
    if (!safePath.test(file.name) || declared.has(file.name) || declared.size >= entryLimit) throw Error('archive-entry');
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) throw Error('archive-size');
    declaredTotal += file.originalSize;
    if (declaredTotal > expandedLimit) throw Error('archive-size');
    if (file.compression !== 0 && file.compression !== 8) throw Error('archive-entry');
    declared.set(file.name, file);
    return false; // Never allocate a buffer from an untrusted declared length.
  } });
  const entries: Record<string, Uint8Array> = {};
  const started = new Set<string>();
  let actualTotal = 0;
  const unzipper = new Unzip(file => {
    const expected = declared.get(file.name);
    // KeepAny v1 exports zipSync entries with known local lengths. fflate's
    // descriptor scanner can mistake signatures inside stored file contents
    // for headers, so unknown-length streaming containers are not accepted.
    if (!expected || started.has(file.name) || file.compression !== expected.compression ||
      file.originalSize === undefined || file.size === undefined ||
      file.originalSize !== expected.originalSize || file.size !== expected.size) throw Error('archive-entry');
    started.add(file.name);
    const chunks: Uint8Array[] = [];
    let actualSize = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      actualSize += chunk.length;
      actualTotal += chunk.length;
      if (actualSize > expected.originalSize || actualTotal > expandedLimit) throw Error('archive-size');
      chunks.push(chunk);
      if (final) {
        if (actualSize !== expected.originalSize) throw Error('archive-size');
        const output = new Uint8Array(actualSize);
        let offset = 0;
        for (const part of chunks) { output.set(part, offset); offset += part.length; }
        entries[file.name] = output;
        chunks.length = 0;
      }
    };
    file.start();
  });
  unzipper.register(UnzipInflate);
  // A small compressed input bounds one synchronous Inflate output burst.
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    unzipper.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  }
  if (Object.keys(entries).length !== declared.size) throw Error('archive-missing');
  return entries;
}
