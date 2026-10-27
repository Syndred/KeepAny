export interface DatasetSummary {
  name: string; createdAt: string; active: boolean; phase: 'retained' | 'candidate' | 'active' | 'abandoned';
}
export interface DatasetAdapter {
  list(): Promise<DatasetSummary[]>;
  subscribe(listener: () => void): () => void;
  switchTo(name: string): Promise<void>;
  resume(name: string): Promise<number>;
  abandon(name: string): Promise<void>;
}
let adapter: DatasetAdapter | undefined;
export function registerDatasetAdapter(value: DatasetAdapter): void { adapter = value; }
export function getDatasetAdapter(): DatasetAdapter | undefined { return adapter; }
