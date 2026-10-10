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
  /** Additional exact login identifiers, protected inside the KDBX entry. */
  usernameAliases?: string[];
  password: string;
  url: string;
  notes: string;
  linkedAssetIds: string[];
  /** Explicit model-service authorization, kept inside the encrypted KDBX entry. */
  aiKeyBinding?: { version: 1; provider: string; baseURL: string };
};

export type VaultEntrySummary = {
  id: string;
  title: string;
  username: string;
  usernameAliases?: string[];
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
  /** Entry/security revision; encrypted import-draft writes leave it unchanged. */
  contentRevision: string | null;
};

export type VaultHistoryItem = { at: string; draft: VaultEntryDraft };

export type VaultImportItem = {
  draft: VaultEntryDraft;
  /** Conflicts remain unchanged unless the caller makes an explicit choice. */
  action?: 'skip' | 'new' | 'update';
  targetId?: string;
};

export type VaultImportPreviewRow = {
  index: number;
  status: 'new' | 'duplicate' | 'conflict';
  /** Existing active entries with the same exact URL/title and username; no secret fields. */
  existingIds: string[];
  /** Earlier row in this batch with the same exact identity and password, when not already saved. */
  duplicateOfIndex?: number;
};

export type VaultImportPreview = {
  revision: string;
  rows: VaultImportPreviewRow[];
};
export type VaultImportResult = {
  added: number;
  updated: number;
  skipped: number;
  entryIds: string[];
  /** Actual writes aligned with the input rows; skipped rows have no entry ID. */
  entryIdsByRow: (string | null)[];
  revision: string;
};
