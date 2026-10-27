import { assetSchema, newAsset, type AssetKind } from '../../../packages/domain/src';
import { hasExplicitImportSecret } from './ai-import-input';
import { stageReviewedCandidates, type ReviewedCandidate } from './intake-review-store';

const supportedKinds = ['project', 'account', 'subscription', 'item'];

/** Local capture deliberately treats each line as a name, without inferring fields. */
export async function stageTextForReview(text: string, kind: AssetKind, fileName: string, isCurrent: () => boolean = () => true): Promise<number> {
  const lines = text.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean);
  if (!supportedKinds.includes(kind) || !text.trim() || text.length > 20_000 || lines.length > 200 || lines.some(line => line.length > 160)) throw Error('text-limit');
  if (hasExplicitImportSecret(text)) throw Error('text-secret');
  const bytes = new TextEncoder().encode(JSON.stringify([kind, text]));
  const fileHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (!isCurrent()) throw Error('review-cancelled');
  const createdAt = new Date().toISOString();
  const rows: ReviewedCandidate[] = lines.map((name, index) => ({
    id: `text-${fileHash}-${index + 1}`, fileHash, fileName, rowNumber: index + 1, source: 'text', sourceText: text,
    asset: assetSchema.parse({ ...newAsset(kind), id: `text-${fileHash.slice(0, 48)}-${index + 1}`, name, createdAt, updatedAt: createdAt }),
    status: 'pending',
  }));
  await stageReviewedCandidates(rows, isCurrent);
  return rows.length;
}
