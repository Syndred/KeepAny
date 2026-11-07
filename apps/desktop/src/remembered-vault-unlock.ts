import { invoke } from "@tauri-apps/api/core";
import type { RememberedVaultUnlock } from "../../web/src/remembered-vault-unlock";

const profileKey = "keepany-desktop-vault-unlock-profile";
const profileFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function readProfile(): string | null {
  try {
    const profile = localStorage.getItem(profileKey);
    return profile && profileFormat.test(profile) ? profile : null;
  } catch {
    return null;
  }
}

export const desktopRememberedVaultUnlock: RememberedVaultUnlock = {
  hasSaved: () => readProfile() !== null,
  async save(value) {
    const existingProfile = readProfile();
    const profile = existingProfile ?? crypto.randomUUID();
    const bytes = Array.from(value);
    try {
      await invoke("save_remembered_vault_key", { profile, value: bytes });
      if (existingProfile) return;
      try {
        localStorage.setItem(profileKey, profile);
      } catch (error) {
        await invoke("forget_remembered_vault_key", { profile });
        throw error;
      }
    } finally {
      bytes.fill(0);
    }
  },
  async load() {
    const profile = readProfile();
    if (!profile) return null;
    const bytes = await invoke<number[] | null>("load_remembered_vault_key", { profile });
    if (!bytes) return null;
    try {
      return Uint8Array.from(bytes);
    } finally {
      bytes.fill(0);
    }
  },
  async forget() {
    const profile = readProfile();
    if (!profile) return;
    await invoke("forget_remembered_vault_key", { profile });
    localStorage.removeItem(profileKey);
  },
};
