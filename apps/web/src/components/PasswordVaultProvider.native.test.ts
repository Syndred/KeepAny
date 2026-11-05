import { expect, it } from "vitest";
import * as provider from "./PasswordVaultProvider";
import { VaultSession } from "../../../../packages/password-vault/src";
import type { VaultRecord } from "../../../../packages/password-vault/src";
it("locks immediately on native background even during an in-flight encrypted commit and permits one complete readback", async () => {
  expect(provider.bindNativeVaultLifecycle, "native background must invalidate vault operations").toBeTypeOf("function");
  let record: VaultRecord | null = null;
  let writes = 0;
  let pause = false;
  let arrived!: () => void, proceed!: () => void;
  const reached = new Promise<void>(resolve => { arrived = resolve; });
  const resume = new Promise<void>(resolve => { proceed = resolve; });
  const session = new VaultSession({ read: async () => record, write: async (bytes, expectedRevision) => {
    expect(record?.revision ?? null).toBe(expectedRevision);
    if (pause) { arrived(); await resume; }
    writes++;
    record = { id: "local", bytes: bytes.slice(), revision: `synthetic-${writes}`, updatedAt: new Date().toISOString() };
    return record!;
  } });
  await session.initialize(); await session.create("synthetic-master");
  const events = new EventTarget();
  const cleanup = provider.bindNativeVaultLifecycle(events, () => session.lock());
  pause = true;
  const pending = session.saveEntry({ title: "Synthetic account", username: "user", password: "synthetic-only", url: "", notes: "", linkedAssetIds: [] });
  const interrupted = expect(pending).rejects.toThrow("vault-locked");
  await reached;
  events.dispatchEvent(new Event("keepany-native-background"));
  expect(session.getSnapshot().status).toBe("locked");
  proceed(); await interrupted;
  expect(writes).toBe(2);
  expect(session.getSnapshot()).toMatchObject({ status: "locked", entries: [] });
  await session.unlock("synthetic-master");
  expect(session.getSnapshot().entries.map(row => row.title)).toEqual(["Synthetic account"]);
  expect(writes).toBe(2);
  session.lock(); cleanup();
}, 30_000);

it("invalidates an empty-vault import in progress, then reads its single completed encrypted revision while locked", async () => {
  let sourceRecord: VaultRecord | null = null;
  const source = new VaultSession({
    read: async () => sourceRecord,
    write: async bytes => {
      sourceRecord = { id: "local", bytes: bytes.slice(), revision: crypto.randomUUID(), updatedAt: new Date().toISOString() };
      return sourceRecord;
    },
  });
  await source.initialize();
  await source.create("synthetic-import-master");
  await source.saveEntry({ title: "Imported synthetic account", username: "user", password: "synthetic-only", url: "", notes: "", linkedAssetIds: [] });
  const archive = await source.exportKdbx();
  source.lock();

  let record: VaultRecord | null = null;
  let writes = 0;
  let arrived!: () => void, proceed!: () => void;
  const reached = new Promise<void>(resolve => { arrived = resolve; });
  const resume = new Promise<void>(resolve => { proceed = resolve; });
  const session = new VaultSession({
    read: async () => record,
    write: async (bytes, expectedRevision) => {
      expect(expectedRevision).toBeNull();
      arrived(); await resume;
      writes++;
      record = { id: "local", bytes: bytes.slice(), revision: "synthetic-import", updatedAt: new Date().toISOString() };
      return record;
    },
  });
  await session.initialize();
  const events = new EventTarget();
  const cleanup = provider.bindNativeVaultLifecycle(events, () => session.lock());
  const importing = session.importKdbx(archive, "synthetic-import-master");
  const interrupted = expect(importing).rejects.toThrow("vault-locked");
  await reached;
  events.dispatchEvent(new Event("keepany-native-background"));
  expect(session.getSnapshot()).toMatchObject({ status: "empty", entries: [] });
  proceed(); await interrupted;
  expect(writes).toBe(1);

  // Mirrors the provider's explicit encrypted-revision reconciliation. It is
  // auxiliary white-box evidence, not a mounted-provider or system-picker test.
  await session.initialize();
  expect(session.getSnapshot()).toMatchObject({ status: "locked", revision: "synthetic-import", entries: [] });
  await session.unlock("synthetic-import-master");
  expect(session.getSnapshot().entries.map(row => row.title)).toEqual(["Imported synthetic account"]);
  expect(writes).toBe(1);
  session.lock(); cleanup();
}, 30_000);
