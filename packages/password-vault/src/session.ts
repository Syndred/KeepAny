import { Kdbx, KdbxCredentials } from 'kdbxweb';
import {
  applyDraft, checkBytes, clearCredentials, clearDatabase, configureDatabase, credentials, draftOf, fail,
  encodeImportDraft, findEntry, isTrash, loadDatabase, nextKdbxTime, normalizeDraft,
  readImportDraft, safeError, summaryOf, VAULT_IMPORT_DRAFT_FIELD,
} from './engine';
import type {
  VaultEntryDraft,
  VaultHistoryItem,
  VaultImportItem,
  VaultImportPreview,
  VaultImportPreviewRow,
  VaultImportResult,
  VaultPersistence,
  VaultRecord,
  VaultSnapshot,
} from './types';

export const VAULT_IMPORT_MAX_ENTRIES = 1_000;
export const VAULT_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
const VAULT_MAX_ENTRIES = 10_000;
const VAULT_CONTENT_REVISION_FIELD = 'KeepAny.ContentRevision';

type ImportMutation = {
  index: number;
  action: 'new' | 'update';
  draft: VaultEntryDraft;
  targetId?: string;
};

function normalizeImport(items: VaultImportItem[]): VaultImportItem[] {
  if (!Array.isArray(items)) fail('vault-invalid');
  if (items.length > VAULT_IMPORT_MAX_ENTRIES) fail('vault-size');
  let bytes = 0;
  return items.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      item.draft?.id !== undefined ||
      (item.action !== undefined &&
        !['skip', 'new', 'update'].includes(item.action)) ||
      (item.action === 'update'
        ? typeof item.targetId !== 'string' ||
          !item.targetId ||
          item.targetId.length > 128
        : item.targetId !== undefined)
    )
      fail('vault-invalid');
    const draft = normalizeDraft(item.draft);
    // Bound the entire request before cloning or performing expensive KDF work.
    bytes += new TextEncoder().encode(JSON.stringify(draft)).byteLength;
    if (bytes > VAULT_IMPORT_MAX_BYTES) fail('vault-size');
    return { draft, action: item.action, targetId: item.targetId };
  });
}

function importIdentity(draft: VaultEntryDraft): string {
  // Do not normalize URLs or usernames: visually similar credentials can be distinct.
  return JSON.stringify([
    draft.url ? 'url' : 'title',
    draft.url || draft.title,
    draft.username,
  ]);
}

function planImports(db: Kdbx, items: VaultImportItem[]) {
  const byIdentity = new Map<string, VaultEntryDraft[]>();
  const batchIndexes = new Map<VaultEntryDraft, number>();
  const allEntries = [...db.getDefaultGroup().allEntries()];
  for (const entry of allEntries) {
    if (isTrash(db, entry)) continue;
    const value = draftOf(entry);
    const key = importIdentity(value);
    const matches = byIdentity.get(key) ?? [];
    matches.push(value);
    byIdentity.set(key, matches);
  }
  const rows: VaultImportPreviewRow[] = [];
  const mutations: ImportMutation[] = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const [index, item] of items.entries()) {
    const key = importIdentity(item.draft);
    const matches = byIdentity.get(key) ?? [];
    const target =
      item.action === 'update'
        ? matches.find((value) => value.id === item.targetId)
        : undefined;
    if (item.action === 'update' && !target) fail('vault-invalid');
    const duplicate = matches.find(
      (value) => value.password === item.draft.password,
    );
    // An explicit metadata update must not disappear merely because the
    // password matches. Exact repeats still avoid a new encrypted revision.
    const explicitChange = target && (
      target.title !== item.draft.title ||
      target.notes !== item.draft.notes ||
      JSON.stringify(target.usernameAliases ?? []) !== JSON.stringify(item.draft.usernameAliases ?? []) ||
      JSON.stringify(target.linkedAssetIds) !== JSON.stringify(item.draft.linkedAssetIds) ||
      target.password !== item.draft.password
    );
    rows.push({
      index,
      status: duplicate ? 'duplicate' : matches.length ? 'conflict' : 'new',
      existingIds: matches.flatMap((value) => (value.id ? [value.id] : [])),
      ...(duplicate && batchIndexes.has(duplicate)
        ? { duplicateOfIndex: batchIndexes.get(duplicate) }
        : {}),
    });
    if (
      item.action === 'skip' ||
      (duplicate && !explicitChange) ||
      (matches.length && item.action === undefined)
    ) {
      skipped += 1;
      continue;
    }
    if (item.action === 'update') {
      if (!target) fail('vault-invalid');
      mutations.push({
        index,
        action: 'update',
        draft: item.draft,
        targetId: item.targetId,
      });
      byIdentity.set(
        key,
        matches.map((value) =>
          value === target ? { ...item.draft, id: target.id } : value,
        ),
      );
      updated += 1;
    } else {
      mutations.push({ index, action: 'new', draft: item.draft });
      batchIndexes.set(item.draft, index);
      byIdentity.set(key, [...matches, item.draft]);
      added += 1;
    }
  }
  if (allEntries.length + added > VAULT_MAX_ENTRIES) fail('vault-size');
  return { rows, mutations, added, updated, skipped };
}

async function cloneCredentials(source: KdbxCredentials): Promise<KdbxCredentials> {
  const result = new KdbxCredentials(null);
  await result.ready;
  result.passwordHash = source.passwordHash?.clone();
  result.keyFileHash = source.keyFileHash?.clone();
  return result;
}

export class VaultSession {
  private db: Kdbx | null = null;
  private record: VaultRecord | null = null;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private snapshot: VaultSnapshot = { status: 'loading', entries: [], trash: [], revision: null, contentRevision: null };

  constructor(private readonly storage: VaultPersistence) {}

  subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  };

  getSnapshot = (): VaultSnapshot => this.snapshot;

  private publish(status: VaultSnapshot['status']): void {
    const entries = this.db ? [...this.db.getDefaultGroup().allEntries()] : [];
    this.snapshot = {
      status, revision: this.record?.revision ?? null,
      contentRevision: this.db ? this.contentRevision(this.db) : null,
      entries: entries.filter((entry) => !isTrash(this.db as Kdbx, entry)).map(summaryOf),
      trash: entries.filter((entry) => isTrash(this.db as Kdbx, entry)).map(summaryOf),
    };
    // Subscriber errors must not invalidate an already persisted encrypted revision.
    for (const listener of this.listeners) { try { listener(); } catch { /* Listener owns its rendering errors. */ } }
  }

  private contentRevision(db: Kdbx): string {
    const stored = db.meta.customData.get(VAULT_CONTENT_REVISION_FIELD)?.value;
    if (typeof stored === 'string' && stored.length > 0 && stored.length <= 256) return stored;
    if (!this.record) fail('vault-missing');
    return this.record.revision;
  }

  private checkGeneration(generation: number): void {
    if (generation !== this.generation) fail('vault-locked');
  }

  private run<T>(operation: (generation: number) => Promise<T>): Promise<T> {
    const generation = this.generation;
    const result = this.queue.then(async () => {
      this.checkGeneration(generation);
      try { return await operation(generation); }
      catch (error) { this.checkGeneration(generation); throw safeError(error); }
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private unlocked(): Kdbx {
    if (!this.db || this.snapshot.status !== 'unlocked') fail('vault-locked');
    return this.db;
  }

  async initialize(): Promise<void> {
    return this.run(async (generation) => {
      const record = await this.storage.read();
      this.checkGeneration(generation);
      if (record) checkBytes(record.bytes);
      clearDatabase(this.db);
      this.db = null;
      this.record = record ? { ...record, bytes: record.bytes.slice() } : null;
      this.publish(record ? 'locked' : 'empty');
    });
  }

  lock(): void {
    this.generation += 1;
    clearDatabase(this.db);
    this.db = null;
    this.publish(this.record ? 'locked' : 'empty');
  }

  private async persist(candidate: Kdbx, expectedRevision: string | null, generation: number, preservedContentRevision?: string): Promise<void> {
    try {
      candidate.meta.customData.set(VAULT_CONTENT_REVISION_FIELD, { value: preservedContentRevision ?? crypto.randomUUID() });
      const bytes = new Uint8Array(await candidate.save());
      checkBytes(bytes);
      this.checkGeneration(generation);
      const record = await this.storage.write(bytes, expectedRevision);
      this.checkGeneration(generation);
      clearDatabase(this.db);
      this.record = { ...record, bytes: record.bytes.slice() };
      this.db = candidate;
      this.publish('unlocked');
    } catch (error) {
      clearDatabase(candidate);
      throw error;
    }
  }

  async create(master: string): Promise<void> {
    return this.run(async (generation) => {
      if (this.snapshot.status !== 'empty') fail('vault-invalid');
      const candidate = Kdbx.create(credentials(master, true), 'StackPerch');
      configureDatabase(candidate);
      await this.persist(candidate, null, generation);
    });
  }

  async unlock(master: string): Promise<void> {
    return this.run(async (generation) => {
      if (this.snapshot.status !== 'locked') fail('vault-locked');
      // Re-read on every unlock so another tab's revision or master rotation is authoritative.
      const record = await this.storage.read();
      this.checkGeneration(generation);
      if (!record) fail('vault-missing');
      const candidate = await loadDatabase(record.bytes, credentials(master));
      try {
        this.checkGeneration(generation);
        this.record = { ...record, bytes: record.bytes.slice() };
        this.db = candidate;
        this.publish('unlocked');
      } catch (error) { clearDatabase(candidate); throw error; }
    });
  }

  private async mutate<T>(generation: number, operation: (candidate: Kdbx) => T | Promise<T>, preserveContentRevision = false): Promise<T> {
    const db = this.unlocked();
    const record = this.record;
    if (!record) fail('vault-missing');
    // Mutate an independently loaded candidate: a failed CAS cannot alter the visible session.
    const key = await cloneCredentials(db.credentials);
    this.checkGeneration(generation);
    const candidate = await loadDatabase(record.bytes, key);
    try {
      this.checkGeneration(generation);
      const result = await operation(candidate);
      this.checkGeneration(generation);
      await this.persist(candidate, record.revision, generation, preserveContentRevision ? this.contentRevision(db) : undefined);
      return result;
    } catch (error) { clearDatabase(candidate); throw error; }
  }

  async saveEntry(value: VaultEntryDraft): Promise<string> {
    const draft = normalizeDraft(value);
    return this.run((generation) => this.mutate(generation, (candidate) => {
      const entry = draft.id ? findEntry(candidate, draft.id) : candidate.createEntry(candidate.getDefaultGroup());
      if (isTrash(candidate, entry)) fail('vault-invalid');
      if (draft.id) entry.pushHistory();
      applyDraft(entry, draft);
      return entry.uuid.id;
    }));
  }

  /** Link reviewed public account records in one encrypted write, without replacing entry content. */
  async linkAccounts(items: { entryId: string; accountId: string }[], expectedContentRevision: string): Promise<void> {
    const links = items.map(item => ({ ...item }));
    if (!links.length || links.length > 200 || links.some(item => !item.entryId || !item.accountId || item.accountId.length > 96)) fail('vault-invalid');
    return this.run(async (generation) => {
      const db = this.unlocked();
      if (this.contentRevision(db) !== expectedContentRevision) fail('vault-stale');
      const unchanged = links.every(item => {
        const entry = findEntry(db, item.entryId);
        const draft = draftOf(entry);
        if (isTrash(db, entry) || draft.aiKeyBinding) fail('vault-invalid');
        return draft.linkedAssetIds.includes(item.accountId);
      });
      if (unchanged) {
        const stored = await this.storage.read();
        this.checkGeneration(generation);
        if (stored?.revision !== this.record?.revision) fail('vault-stale');
        return;
      }
      await this.mutate(generation, candidate => {
        for (const item of links) {
          const entry = findEntry(candidate, item.entryId);
          if (isTrash(candidate, entry)) fail('vault-invalid');
          const draft = draftOf(entry);
          if (draft.aiKeyBinding) fail('vault-invalid');
          if (draft.linkedAssetIds.includes(item.accountId)) continue;
          entry.pushHistory();
          applyDraft(entry, normalizeDraft({ ...draft, linkedAssetIds: [...draft.linkedAssetIds, item.accountId] }));
        }
      });
    });
  }

  readEntry(id: string): VaultEntryDraft { return draftOf(findEntry(this.unlocked(), id)); }

  /** Never exposes this unreviewed application state as a password entry. */
  readImportDraft(): string | null { return readImportDraft(this.unlocked()); }

  /** Returns the durable revision so callers can advance their import review base. */
  async writeImportDraft(value: string | null, expectedRevision: string): Promise<string> {
    const encoded = encodeImportDraft(value);
    if (typeof expectedRevision !== 'string' || !expectedRevision || expectedRevision.length > 256) fail('vault-invalid');
    return this.run(async (generation) => {
      const db = this.unlocked();
      if (this.record?.revision !== expectedRevision) fail('vault-stale');
      // Even a same-payload no-op must reject another tab's durable write.
      const stored = await this.storage.read();
      this.checkGeneration(generation);
      if (stored?.revision !== expectedRevision) fail('vault-stale');
      const current = db.meta.customData.get(VAULT_IMPORT_DRAFT_FIELD)?.value ?? null;
      if (current === encoded) return expectedRevision;
      await this.mutate(generation, (candidate) => {
        if (encoded === null) candidate.meta.customData.delete(VAULT_IMPORT_DRAFT_FIELD);
        else candidate.meta.customData.set(VAULT_IMPORT_DRAFT_FIELD, { value: encoded });
      }, true);
      if (!this.record) fail('vault-missing');
      return this.record.revision;
    });
  }

  previewImport(values: VaultEntryDraft[]): VaultImportPreview {
    const db = this.unlocked();
    if (!this.record) fail('vault-missing');
    if (!Array.isArray(values)) fail('vault-invalid');
    if (values.length > VAULT_IMPORT_MAX_ENTRIES) fail('vault-size');
    const items = normalizeImport(values.map((draft) => ({ draft })));
    return {
      revision: this.record.revision,
      rows: planImports(db, items).rows,
    };
  }

  async importEntries(
    values: VaultImportItem[],
    expectedRevision: string,
  ): Promise<VaultImportResult> {
    const items = normalizeImport(values);
    if (
      typeof expectedRevision !== 'string' ||
      !expectedRevision ||
      expectedRevision.length > 256
    )
      fail('vault-invalid');
    return this.run(async (generation) => {
      const db = this.unlocked();
      if (this.record?.revision !== expectedRevision) fail('vault-stale');
      // A no-op still checks durable state; a stale preview must never report successful import.
      const stored = await this.storage.read();
      this.checkGeneration(generation);
      if (stored?.revision !== expectedRevision) fail('vault-stale');
      const plan = planImports(db, items);
      let entryIds: string[] = [];
      const entryIdsByRow: (string | null)[] = items.map(() => null);
      if (plan.mutations.length) {
        entryIds = await this.mutate(generation, (candidate) =>
          plan.mutations.map((mutation) => {
            const entry =
              mutation.action === 'update'
                ? findEntry(candidate, mutation.targetId as string)
                : candidate.createEntry(candidate.getDefaultGroup());
            if (isTrash(candidate, entry)) fail('vault-invalid');
            if (mutation.action === 'update') {
              if (entry.history.length >= 1_000) fail('vault-size');
              entry.pushHistory();
            }
            applyDraft(entry, mutation.draft);
            entryIdsByRow[mutation.index] = entry.uuid.id;
            return entry.uuid.id;
          }),
        );
      }
      this.checkGeneration(generation);
      if (!this.record) fail('vault-missing');
      return {
        added: plan.added,
        updated: plan.updated,
        skipped: plan.skipped,
        entryIds,
        entryIdsByRow,
        revision: this.record.revision,
      };
    });
  }

  async trashEntry(id: string): Promise<void> {
    return this.run((generation) => this.mutate(generation, (candidate) => {
      const entry = findEntry(candidate, id);
      if (isTrash(candidate, entry)) fail('vault-invalid');
      candidate.meta.recycleBinEnabled = true;
      candidate.createRecycleBin();
      const previous = entry.locationChanged;
      candidate.remove(entry);
      entry.times.locationChanged = nextKdbxTime(previous);
    }));
  }

  async restoreEntry(id: string): Promise<void> {
    return this.run((generation) => this.mutate(generation, (candidate) => {
      const entry = findEntry(candidate, id);
      if (!isTrash(candidate, entry)) fail('vault-invalid');
      const previous = entry.previousParentGroup && candidate.getGroup(entry.previousParentGroup);
      const locationChanged = entry.locationChanged;
      let previousIsTrash = false;
      for (let group = previous || undefined; group; group = group.parentGroup) {
        if (group.uuid.id === candidate.meta.recycleBinUuid?.id) previousIsTrash = true;
      }
      candidate.move(entry, previous && !previousIsTrash ? previous : candidate.getDefaultGroup());
      entry.times.locationChanged = nextKdbxTime(locationChanged);
    }));
  }

  history(id: string): VaultHistoryItem[] {
    return findEntry(this.unlocked(), id).history.map((entry) => ({
      at: (entry.times.lastModTime ?? new Date(0)).toISOString(), draft: draftOf(entry),
    }));
  }

  async restoreHistory(id: string, index: number): Promise<void> {
    return this.run((generation) => this.mutate(generation, (candidate) => {
      const entry = findEntry(candidate, id);
      if (isTrash(candidate, entry) || !Number.isSafeInteger(index) || !entry.history[index]) fail('vault-invalid');
      const draft = normalizeDraft(draftOf(entry.history[index]));
      entry.pushHistory();
      applyDraft(entry, draft);
    }));
  }

  async changeMasterPassword(current: string, next: string): Promise<void> {
    return this.run(async (generation) => {
      const record = this.record;
      this.unlocked();
      if (!record) fail('vault-missing');
      const candidate = await loadDatabase(record.bytes, credentials(current));
      let nextCredentials: KdbxCredentials | null = null;
      try {
        this.checkGeneration(generation);
        nextCredentials = credentials(next, true);
        await nextCredentials.ready;
        this.checkGeneration(generation);
        clearCredentials(candidate.credentials);
        candidate.credentials = nextCredentials;
        candidate.meta.keyChanged = new Date();
        configureDatabase(candidate);
        await this.persist(candidate, record.revision, generation);
      } catch (error) { clearDatabase(candidate); throw error; }
      finally {
        if (nextCredentials && this.db?.credentials !== nextCredentials) {
          await nextCredentials.ready;
          clearCredentials(nextCredentials);
        }
      }
    });
  }

  async exportKdbx(): Promise<Uint8Array> {
    return this.run(async (generation) => {
      this.unlocked();
      // Export the exact persisted encrypted revision, avoiding a needless KDF or state change.
      if (!this.record) fail('vault-missing');
      const stored = await this.storage.read();
      this.checkGeneration(generation);
      if (!stored || stored.revision !== this.record.revision) fail('vault-stale');
      return this.record.bytes.slice();
    });
  }

  async importKdbx(value: Uint8Array, password: string): Promise<void> {
    checkBytes(value);
    const bytes = value.slice();
    return this.run(async (generation) => {
      if (this.snapshot.status !== 'empty' && this.snapshot.status !== 'unlocked') fail('vault-locked');
      const imported = await loadDatabase(bytes, credentials(password));
      try { this.checkGeneration(generation); }
      catch (error) { clearDatabase(imported); throw error; }
      if (this.snapshot.status === 'empty') {
        configureDatabase(imported);
        await this.persist(imported, null, generation);
        return;
      }
      try { await this.mutate(generation, (candidate) => {
        const root = candidate.getDefaultGroup();
        const remoteRoot = imported.getDefaultGroup();
        if (root.uuid.id === remoteRoot.uuid.id) {
          // A restored backup must not overwrite local work or revive a discarded
          // draft. Empty-vault adoption above intentionally retains its backup draft.
          const localDraft = candidate.meta.customData.get(VAULT_IMPORT_DRAFT_FIELD);
          candidate.merge(imported);
          if (localDraft) candidate.meta.customData.set(VAULT_IMPORT_DRAFT_FIELD, localDraft);
          else candidate.meta.customData.delete(VAULT_IMPORT_DRAFT_FIELD);
        }
        else {
          const existingIds = new Set([...root.allEntries()].map((entry) => entry.uuid.id));
          const entries = [...remoteRoot.allEntries()];
          if (entries.some((entry) => existingIds.has(entry.uuid.id))) fail('vault-stale');
          candidate.meta.recycleBinEnabled = true;
          candidate.createRecycleBin();
          const bin = candidate.meta.recycleBinUuid && candidate.getGroup(candidate.meta.recycleBinUuid);
          if (!bin) fail('vault-invalid');
          for (const entry of entries) {
            const added = candidate.importEntry(entry, isTrash(imported, entry) ? bin : root, imported);
            // importEntry generates fresh UUIDs; retain originals when collision checks passed.
            added.uuid = entry.uuid;
            added.times = entry.times.clone();
            for (const historical of added.history) historical.uuid = entry.uuid;
          }
        }
        configureDatabase(candidate);
      }); }
      catch (error) { clearDatabase(imported); throw error; }
      // Upstream same-vault merge may adopt groups/entries by reference. Those fields are now
      // owned by the live candidate and must not be wiped here; only discard the import key.
      clearCredentials(imported.credentials);
    });
  }
}
