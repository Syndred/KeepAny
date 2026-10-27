import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
const der = (tag: number, ...values: Uint8Array[]) => {
  const value = Buffer.concat(values);
  const size = value.length < 128 ? Buffer.from([value.length]) : (() => {
    let n = value.length; const bytes: number[] = [];
    while (n) { bytes.unshift(n & 255); n >>>= 8; }
    return Buffer.from([128 | bytes.length, ...bytes]);
  })();
  return Buffer.concat([Buffer.from([tag]), size, value]);
};
const sequence = (...values: Uint8Array[]) => der(0x30, ...values);
export function certificate(ip = '127.0.0.1') {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const algorithm = sequence(der(6, Buffer.from('2a8648ce3d040302', 'hex')));
  const name = sequence(der(0x31, sequence(der(6, Buffer.from('550403', 'hex')), der(12, Buffer.from('KeepAny synthetic TLS')))));
  const utc = (date: Date) => der(23, Buffer.from(`${date.toISOString().replace(/\D/g, '').slice(2, 14)}Z`));
  const serial = randomBytes(16); serial[0] &= 0x7f; serial[0] ||= 1;
  const san = sequence(der(6, Buffer.from('551d11', 'hex')), der(4, sequence(der(0x87, Buffer.from(ip.split('.').map(Number))))));
  const constraints = sequence(der(6, Buffer.from('551d13', 'hex')), der(1, Buffer.from([255])), der(4, sequence()));
  const tbs = sequence(der(0xa0, der(2, Buffer.from([2]))), der(2, serial), algorithm, name,
    sequence(utc(new Date(Date.now() - 60_000)), utc(new Date(Date.now() + 3_600_000))), name,
    keys.publicKey.export({ format: 'der', type: 'spki' }), der(0xa3, sequence(san, constraints)));
  const bytes = sequence(tbs, algorithm, der(3, Buffer.from([0]), sign('sha256', tbs, keys.privateKey)));
  const pem = `-----BEGIN CERTIFICATE-----\n${bytes.toString('base64').match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----\n`;
  const x509 = new X509Certificate(pem);
  if (!Number.isFinite(Date.parse(x509.validFrom)) || !Number.isFinite(Date.parse(x509.validTo)) || x509.checkIP(ip) !== ip)
    throw Error('synthetic-certificate-invalid');
  return { pem, key: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    pin: createHash('sha256').update(x509.publicKey.export({ format: 'der', type: 'spki' })).digest('hex') };
}

