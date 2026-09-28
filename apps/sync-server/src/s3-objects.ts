import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  AttachmentIntegrityError, CIPHERTEXT_ATTACHMENT_TYPE, MAX_CIPHERTEXT_ATTACHMENT_BYTES,
  type CiphertextObjectStore,
} from '../../../packages/sync-core/src/attachments';

export class S3CiphertextObjectStore implements CiphertextObjectStore {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: Buffer.from(bytes), ContentType: CIPHERTEXT_ATTACHMENT_TYPE,
    }));
  }

  async get(key: string): Promise<Uint8Array | null> {
    let response;
    try { response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); }
    catch (error) {
      if (error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'NotFound')) return null;
      throw error;
    }
    if (!response.Body) return null;
    if (response.ContentLength && response.ContentLength > MAX_CIPHERTEXT_ATTACHMENT_BYTES) throw new AttachmentIntegrityError();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      length += chunk.length;
      if (length > MAX_CIPHERTEXT_ATTACHMENT_BYTES) throw new AttachmentIntegrityError();
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, length);
  }
}

export function createS3CiphertextObjectStore(env: NodeJS.ProcessEnv): S3CiphertextObjectStore | null {
  const bucket = env.KEEPANY_S3_BUCKET;
  if (!bucket) return null;
  const region = env.KEEPANY_S3_REGION;
  if (!region) throw Error('KEEPANY_S3_REGION-required');
  const endpoint = env.KEEPANY_S3_ENDPOINT;
  if (endpoint) {
    const url = new URL(endpoint);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('KEEPANY_S3_ENDPOINT-invalid');
  }
  const accessKeyId = env.KEEPANY_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.KEEPANY_S3_SECRET_ACCESS_KEY;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw Error('KEEPANY_S3-credentials');
  const client = new S3Client({
    region, endpoint, forcePathStyle: Boolean(endpoint),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return new S3CiphertextObjectStore(client, bucket);
}
