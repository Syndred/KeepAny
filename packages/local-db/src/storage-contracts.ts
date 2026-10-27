import type { EntityType } from '../../domain/src';
import type { RecordRow } from './index';
import type { RxDatabase } from 'rxdb';

export interface StoredRecord extends RecordRow {
  revision: string;
  internalDeleted: boolean;
}
export interface RecordChange { previous: StoredRecord | null; next: RecordRow; internalDeleted?: boolean }
export interface WriteResult { success: string[]; error: Array<{ documentId: string; status: number }> }
export interface RecordBackend {
  readonly name: string;
  /** Diagnostic compatibility for existing Web storage fault-injection tests. Absent on Native. */
  readonly webDatabase?: RxDatabase;
  get(id: string, includeInternalDeleted?: boolean): Promise<StoredRecord | null>;
  getMany(ids: readonly string[], includeInternalDeleted?: boolean): Promise<StoredRecord[]>;
  list(type?: EntityType): Promise<StoredRecord[]>;
  insert(row: RecordRow): Promise<void>;
  insertMany(rows: readonly RecordRow[]): Promise<WriteResult>;
  modify(id: string, modifier: (row: RecordRow) => RecordRow | Promise<RecordRow>): Promise<void>;
  compareAndWrite(changes: readonly RecordChange[], context: string): Promise<WriteResult>;
  remove(id: string, expectedRevision: string): Promise<void>;
  subscribe(listener: () => void): () => void;
  close(): Promise<void>;
}

export interface SideTableRef { readonly name: string; count(): Promise<number> }
export interface SideTable<T extends { id: string }> extends SideTableRef {
  get(id: string): Promise<T | undefined>;
  add(value: T, key?: string): Promise<string>;
  put(value: T, key?: string): Promise<string>;
  update(id: string, patch: Partial<T>): Promise<number>;
  delete(id: string): Promise<void>;
  bulkDelete(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
  toArray(): Promise<T[]>;
  keys(): Promise<string[]>;
  equals<K extends keyof T & string>(field: K, value: T[K]): Promise<T[]>;
  deleteEquals<K extends keyof T & string>(field: K, value: T[K]): Promise<number>;
  distinct<K extends keyof T & string>(field: K): Promise<T[K][]>;
}
export interface SideStoreRuntime {
  readonly name: string;
  readonly records: RecordBackend;
  transaction<T>(mode: 'r' | 'rw', tables: SideTableRef | readonly (SideTableRef | string)[], action: (scope: this) => Promise<T>): Promise<T>;
  /** Web's records commit outside the side-table transaction. Native must preserve that durable intent ordering. */
  outsideTransaction<T>(action: () => Promise<T>): Promise<T>;
  waitFor<T>(promise: Promise<T>): Promise<T>;
  subscribe(listener: () => void): () => void;
  open(): Promise<void>;
  close(): void;
}
