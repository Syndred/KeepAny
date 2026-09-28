import { assetSchema, type Asset } from '../../domain/src';
import type { LocalRepository, RecordRow } from '../../local-db/src';
import { digest } from './authority';
import type { AssetSnapshot, McpAssetStore } from './service';

const editable = new Set(['name', 'category', 'tags', 'description', 'url', 'updatedAt']);
const snapshot = (row: RecordRow): AssetSnapshot => ({ asset: assetSchema.parse(JSON.parse(row.payload)), version: digest(row.payload) });

// This adapter writes through the same RxDB records collection observed by the web app.
// It must run in that IndexedDB origin/context; a separate Node process cannot open a browser's database.
export class RxdbMcpAssetStore implements McpAssetStore {
  constructor(private readonly repository: LocalRepository) {}

  async get(id: string): Promise<AssetSnapshot | null> {
    const document = await this.repository.db.records.findOne(`asset:${id}`).exec();
    return document ? snapshot(document.toJSON() as RecordRow) : null;
  }

  async list(ids: readonly string[]): Promise<AssetSnapshot[]> {
    const rows = await Promise.all(ids.map(id => this.get(id)));
    return rows.filter((row): row is AssetSnapshot => row !== null);
  }

  async compareAndSet(id: string, expectedVersion: string, next: Asset): Promise<'applied' | 'conflict'> {
    const parsedNext = assetSchema.parse(next);
    if (parsedNext.id !== id || parsedNext.deleted) throw Error('invalid-asset-update');
    const document = await this.repository.db.records.findOne(`asset:${id}`).exec();
    if (!document) return 'conflict';
    const conflict = Symbol('conflict');
    try {
      await document.incrementalModify((data: RecordRow) => {
        if (digest(data.payload) !== expectedVersion) throw conflict;
        const previous = assetSchema.parse(JSON.parse(data.payload));
        if (previous.deleted) throw conflict;
        for (const field of Object.keys(previous) as Array<keyof Asset>) {
          if (!editable.has(field) && JSON.stringify(previous[field]) !== JSON.stringify(parsedNext[field]))
            throw Error('forbidden-asset-field');
        }
        return { ...data, payload: JSON.stringify(parsedNext), updatedAt: Date.now() };
      });
      return 'applied';
    } catch (error) {
      if (error === conflict) return 'conflict';
      throw error;
    }
  }
}
