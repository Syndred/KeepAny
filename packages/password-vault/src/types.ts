export type VaultRecord = {
  id: 'local';
  revision: string;
  bytes: Uint8Array;
  updatedAt: string;
};

export interface VaultPersistence {
  read(): Promise<VaultRecord | null>;
  write(bytes: Uint8Array, expectedRevision: string | null): Promise<VaultRecord>;
}

export type VaultEntryDraft = {
  id?: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  linkedAssetIds: string[];
};

export type VaultEntrySummary = {
  id: string;
  title: string;
  username: string;
  url: string;
  linkedAssetIds: string[];
  modifiedAt: string;
  historyCount: number;
};

export type VaultSnapshot = {
  status: 'loading' | 'empty' | 'locked' | 'unlocked';
  entries: VaultEntrySummary[];
  trash: VaultEntrySummary[];
  revision: string | null;
};

export type VaultHistoryItem = { at: string; draft: VaultEntryDraft };
