import { Kdbx, KdbxCredentials } from 'kdbxweb';
import {
  applyDraft, checkBytes, clearCredentials, clearDatabase, configureDatabase, credentials, draftOf, fail,
  findEntry, isTrash, loadDatabase, nextKdbxTime, normalizeDraft, safeError, summaryOf,
} from './engine';
import type { VaultEntryDraft, VaultHistoryItem, VaultPersistence, VaultRecord, VaultSnapshot } from './types';

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
  private snapshot: VaultSnapshot = { status: 'loading', entries: [], trash: [], revision: null };

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
      entries: entries.filter((entry) => !isTrash(this.db as Kdbx, entry)).map(summaryOf),
      trash: entries.filter((entry) => isTrash(this.db as Kdbx, entry)).map(summaryOf),
    };
    // Subscriber errors must not invalidate an already persisted encrypted revision.
    for (const listener of this.listeners) { try { listener(); } catch { /* Listener owns its rendering errors. */ } }
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

  private async persist(candidate: Kdbx, expectedRevision: string | null, generation: number): Promise<void> {
    try {
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
      const candidate = Kdbx.create(credentials(master, true), 'KeepAny');
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

  private async mutate<T>(generation: number, operation: (candidate: Kdbx) => T | Promise<T>): Promise<T> {
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
      await this.persist(candidate, record.revision, generation);
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

  readEntry(id: string): VaultEntryDraft { return draftOf(findEntry(this.unlocked(), id)); }

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
        if (root.uuid.id === remoteRoot.uuid.id) candidate.merge(imported);
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
