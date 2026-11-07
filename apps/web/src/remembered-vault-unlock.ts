export interface RememberedVaultUnlock {
  hasSaved(): boolean;
  save(value: Uint8Array): Promise<void>;
  load(): Promise<Uint8Array | null>;
  forget(): Promise<void>;
}

let adapter: RememberedVaultUnlock | undefined;

export function registerRememberedVaultUnlock(value: RememberedVaultUnlock): void {
  adapter = value;
}

export function getRememberedVaultUnlock(): RememberedVaultUnlock | undefined {
  return adapter;
}
