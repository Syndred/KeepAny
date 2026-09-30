import { BinaryStream, Consts, Int64, Kdbx, KdbxContext, KdbxCredentials, KdbxHeader, ProtectedValue, VarDictionary } from 'kdbxweb';
import { beforeAll, expect, it, vi } from 'vitest';
import { checkHeader } from './header';

vi.mock('hash-wasm', () => { throw new Error('public header validation must not initialize password hashing'); });

const files = new Map<number, Uint8Array>();
function headerOf(bytes: Uint8Array): KdbxHeader {
  return KdbxHeader.read(new BinaryStream(bytes.slice().buffer), new KdbxContext({ kdbx: new Kdbx() }));
}
function fixture(version: number): Uint8Array {
  const bytes = files.get(version);
  if (!bytes) throw new Error('missing synthetic KDBX fixture');
  return bytes;
}

beforeAll(async () => {
  for (const version of [3, 4] as const) {
    const db = Kdbx.create(new KdbxCredentials(ProtectedValue.fromString('synthetic-header-master')), `Framing KDBX${version}`);
    db.setVersion(version);
    if (version === 4) db.setKdf(Consts.KdfId.Aes);
    db.header.compression = Consts.CompressionAlgorithm.None;
    db.createEntry(db.getDefaultGroup()).fields.set('Title', 'Synthetic header validation entry');
    files.set(version, new Uint8Array(await db.save()));
  }
}, 30_000);

it('accepts real upstream KDBX3/4 frames without Argon2 initialization or decryption', () => {
  for (const version of [3, 4]) expect(() => checkHeader(fixture(version))).not.toThrow();
});

it('rejects magic-only files and truncated public headers for both supported versions', () => {
  for (const version of [3, 4]) {
    const bytes = fixture(version);
    expect(() => checkHeader(bytes.subarray(0, 12))).toThrow('vault-invalid');
    const end = headerOf(bytes).endPos;
    if (!end) throw new Error('missing fixture header end');
    expect(() => checkHeader(bytes.subarray(0, end - 1))).toThrow('vault-invalid');
  }
});

it('rejects truncated KDBX3 cipher payload and AES-CBC misalignment', () => {
  const bytes = fixture(3);
  const end = headerOf(bytes).endPos;
  if (!end) throw new Error('missing fixture header end');
  expect(() => checkHeader(bytes.subarray(0, end))).toThrow('vault-invalid');
  expect(() => checkHeader(bytes.subarray(0, end + 15))).toThrow('vault-invalid');
  expect(() => checkHeader(bytes.subarray(0, bytes.length - 1))).toThrow('vault-invalid');
});

it('requires the KDBX4 header hash/HMAC and complete HMAC block headers, bodies and final marker', () => {
  const bytes = fixture(4);
  const end = headerOf(bytes).endPos;
  if (!end) throw new Error('missing fixture header end');
  const firstBlock = end + 64;
  const firstSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(firstBlock + 32, true);
  expect(firstSize).toBeGreaterThan(0);
  for (const truncated of [
    bytes.subarray(0, end + 63), bytes.subarray(0, firstBlock + 35),
    bytes.subarray(0, firstBlock + 36 + firstSize - 1), bytes.subarray(0, bytes.length - 36),
    bytes.subarray(0, bytes.length - 1),
  ]) expect(() => checkHeader(truncated)).toThrow('vault-invalid');
});

it('requires a nonempty KDBX4 block, exact EOF at the zero marker, and bounded advertised block sizes', () => {
  const bytes = fixture(4);
  const end = headerOf(bytes).endPos;
  if (!end) throw new Error('missing fixture header end');
  const firstBlock = end + 64;
  const emptyStream = bytes.slice(0, firstBlock + 36);
  new DataView(emptyStream.buffer).setUint32(firstBlock + 32, 0, true);
  expect(() => checkHeader(emptyStream)).toThrow('vault-invalid');
  const prematureEnd = bytes.slice();
  new DataView(prematureEnd.buffer).setUint32(firstBlock + 32, 0, true);
  expect(() => checkHeader(prematureEnd)).toThrow('vault-invalid');
  const overrun = bytes.slice();
  new DataView(overrun.buffer).setUint32(firstBlock + 32, 0xffff_ffff, true);
  expect(() => checkHeader(overrun)).toThrow('vault-invalid');
  const trailing = new Uint8Array(bytes.length + 1);
  trailing.set(bytes);
  expect(() => checkHeader(trailing)).toThrow('vault-invalid');
});

it('rejects out-of-budget KDF before reporting missing cipher framing', () => {
  const db = Kdbx.create(new KdbxCredentials(ProtectedValue.fromString('synthetic-header-master')), 'Over-budget public header');
  db.setVersion(4);
  db.setKdf(Consts.KdfId.Argon2id);
  db.header.kdfParameters?.set('M', VarDictionary.ValueType.UInt64, Int64.from(129 * 1024 * 1024));
  db.header.generateSalts();
  const stream = new BinaryStream();
  db.header.write(stream);
  expect(() => checkHeader(new Uint8Array(stream.getWrittenBytes()))).toThrow('vault-kdf');
});
