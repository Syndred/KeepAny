import kdbxweb from 'kdbxweb';

// The upstream package ships CommonJS; the default import also works in native Node ESM.
const { BinaryStream, ByteUtils, Consts, Int64, Kdbx, KdbxContext, KdbxError, KdbxHeader } = kdbxweb;

export const VAULT_MAX_BYTES = 16 * 1024 * 1024;

export function fail(code: string): never { throw new Error(code); }

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function checkBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) fail('vault-invalid');
  if (bytes.byteLength > VAULT_MAX_BYTES) fail('vault-size');
}

function number(value: unknown): unknown { return value instanceof Int64 ? value.value : value; }

export function safeError(error: unknown): Error {
  if (error instanceof Error && /^vault-(locked|stale|password|invalid|size|kdf|missing)$/.test(error.message)) return new Error(error.message);
  if (error instanceof KdbxError && error.code === Consts.ErrorCodes.InvalidKey) return new Error('vault-password');
  return new Error('vault-invalid');
}

function checkV4Framing(bytes: Uint8Array, publicHeaderEnd: number): void {
  // KDBX4 has a SHA-256 header hash and a header HMAC before its outer HMAC block stream.
  let offset = publicHeaderEnd + 64;
  if (!Number.isSafeInteger(offset) || offset > bytes.byteLength) fail('vault-invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let hasCiphertext = false;
  for (;;) {
    // Each block is a 32-byte HMAC, a little-endian uint32 size, then that many bytes.
    if (bytes.byteLength - offset < 36) fail('vault-invalid');
    const size = view.getUint32(offset + 32, true);
    offset += 36;
    if (size === 0) {
      if (!hasCiphertext || offset !== bytes.byteLength) fail('vault-invalid');
      return;
    }
    if (size > bytes.byteLength - offset) fail('vault-invalid');
    offset += size;
    hasCiphertext = true;
  }
}

/** Public-header/KDF/framing validation only. Ciphertext authenticity still requires the master password. */
export function checkHeader(bytes: Uint8Array): void {
  checkBytes(bytes);
  try {
    const header = KdbxHeader.read(new BinaryStream(bytes.slice().buffer), new KdbxContext({ kdbx: new Kdbx() }));
    const end = header.endPos;
    if (!integer(end, 12, bytes.byteLength)) fail('vault-invalid');
    if (header.versionMajor === 3) {
      if (!integer(header.keyEncryptionRounds, 1, 1_000_000)) fail('vault-kdf');
      const payloadBytes = bytes.byteLength - end;
      if (payloadBytes < 16 || (header.dataCipherUuid?.id === Consts.CipherId.Aes && payloadBytes % 16 !== 0)) fail('vault-invalid');
      return;
    }
    const params = header.kdfParameters;
    const uuid = params?.get('$UUID');
    if (!(uuid instanceof ArrayBuffer) || !params) fail('vault-kdf');
    const kind = ByteUtils.bytesToBase64(uuid);
    if (kind === Consts.KdfId.Aes) {
      if (!integer(number(params.get('R')), 1, 1_000_000)) fail('vault-kdf');
    } else if (kind === Consts.KdfId.Argon2d || kind === Consts.KdfId.Argon2id) {
      const memory = number(params.get('M'));
      const parallelism = number(params.get('P'));
      if (!integer(parallelism, 1, 4) || !integer(memory, 8 * 1024 * parallelism, 128 * 1024 * 1024)
        || memory % 1024 !== 0 || !integer(number(params.get('I')), 1, 10)
        || params.get('V') !== 0x13 || params.get('K') || params.get('A')) fail('vault-kdf');
    } else fail('vault-kdf');
    // Check framing after the work factors, so an over-budget KDF is rejected before any crypto.
    checkV4Framing(bytes, end);
  } catch (error) { throw safeError(error); }
}
