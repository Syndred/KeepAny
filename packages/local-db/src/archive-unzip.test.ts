import { expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync, Zip, ZipDeflate } from 'fflate';
import { unzipArchive } from './archive-unzip';

function changeDeclaredSize(archive: Uint8Array, size: number, local = true, central = true) {
  const bytes = Uint8Array.from(archive);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i + 30 < bytes.length; i++) {
    const signature = view.getUint32(i, true);
    if ((signature === 0x04034b50 && local) || (signature === 0x02014b50 && central)) {
      view.setUint32(i + (signature === 0x04034b50 ? 22 : 24), size, true);
    }
  }
  return bytes;
}

it.each([0, 6])('reads valid stored and deflated entries without changing their bytes (level %s)', level => {
  const data = { 'manifest.json': strToU8('{}'), 'records.json': strToU8('[]'), 'intake-review.json': new Uint8Array() };
  expect(unzipArchive(zipSync(data, { level: level as 0 | 6 }))).toEqual(data);
});

it('rejects forged small declared sizes instead of accepting fflate synchronous truncation', () => {
  const records = strToU8(`[]${' '.repeat(64 * 1024)}`);
  const forged = changeDeclaredSize(zipSync({ 'records.json': records }), 2);
  expect(unzipSync(forged)['records.json']).toEqual(strToU8('[]')); // The original vulnerable decode.
  expect(() => unzipArchive(forged)).toThrow('archive-size');
});

it('rejects inconsistent local and central declared lengths and inflated declarations', () => {
  const archive = zipSync({ 'records.json': strToU8('[]') });
  expect(() => unzipArchive(changeDeclaredSize(archive, 1, false, true))).toThrow('archive-entry');
  expect(() => unzipArchive(changeDeclaredSize(archive, 20))).toThrow('archive-size');
  expect(() => unzipArchive(changeDeclaredSize(archive, 301 * 1024 * 1024))).toThrow('archive-size');
});

it('refuses unexpected paths before attempting to inflate them', () => {
  expect(() => unzipArchive(zipSync({ '../records.json': strToU8('[]') }))).toThrow('archive-entry');
});

it('explicitly rejects unknown-length descriptor containers before decoding their content', () => {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, data) => { if (error) throw error; chunks.push(data); });
  const file = new ZipDeflate('records.json');
  zip.add(file); file.push(strToU8('[]'), true); zip.end();
  const bytes = new Uint8Array(chunks.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  expect(() => unzipArchive(bytes)).toThrow('archive-entry');
});

it.each([0, 6])('keeps ZIP header signatures inside genuine known-length file content (level %s)', level => {
  const data = new Uint8Array(100);
  data.set([0x50, 0x4b, 0x03, 0x04], 50);
  const path = `files/${crypto.randomUUID()}`;
  expect(unzipArchive(zipSync({ [path]: data }, { level: level as 0 | 6 }))).toEqual({ [path]: data });
});
