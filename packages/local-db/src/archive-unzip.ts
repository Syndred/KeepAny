import { Unzip, UnzipInflate, unzipSync, type UnzipFileInfo } from 'fflate';
import { BACKUP_ARCHIVE_MAX_BYTES } from './backup-crypto';

const expandedLimit = 300 * 1024 * 1024;
const entryLimit = 10003; // Manifest + records + intake reviews + 10,000 attachments.
const safePath = /^(?:manifest\.json|records\.json|intake-review\.json|files\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

// KeepAny v1 writes ordinary single-disk, non-ZIP64 archives. Read only their
// fixed EOCD boundary; fflate remains responsible for entry metadata/decoding.
function localRecordsEnd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) !== 0x06054b50 ||
      offset + 22 + view.getUint16(offset + 20, true) !== bytes.length) continue;
    const count = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 12, true);
    const start = view.getUint32(offset + 16, true);
    if (view.getUint16(offset + 4, true) || view.getUint16(offset + 6, true) ||
      view.getUint16(offset + 8, true) !== count || count > entryLimit ||
      size === 0xffffffff || start === 0xffffffff || start + size !== offset) throw Error('archive-entry');
    return start;
  }
  throw Error('archive-entry');
}

/** Use fflate's metadata filter without decoding, then count actual streaming output. */
export function unzipArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > BACKUP_ARCHIVE_MAX_BYTES) throw Error('archive-size');
  const localEnd = localRecordsEnd(bytes);
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
  if (declared.size && (localEnd + 4 > bytes.length ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(localEnd, true) !== 0x02014b50)) {
    throw Error('archive-entry');
  }
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
  // Four validated central-signature bytes provide the lookahead Unzip needs
  // for a trailing empty stored entry. Never feed central CRC/metadata bytes.
  const parseEnd = declared.size ? localEnd + 4 : localEnd;
  for (let offset = 0; offset < parseEnd; offset += 4096) {
    const end = Math.min(offset + 4096, parseEnd);
    unzipper.push(bytes.subarray(offset, end), end === parseEnd);
  }
  if (Object.keys(entries).length !== declared.size) throw Error('archive-missing');
  return entries;
}
