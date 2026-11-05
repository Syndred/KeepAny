import { afterEach, expect, it, vi } from "vitest";
const implementation = import("./platform-settings").catch(() => null);
afterEach(() => vi.unstubAllGlobals());
it("provides a hydrated settings boundary for language and AI metadata only", async () => {
  const api = await implementation;
  expect(api, "native settings boundary is required").not.toBeNull();
  if (!api) return;
  expect(api.platformSettingKeys).toEqual(["keepany-language", "keepany-ai-settings-v1"]);
  for (const key of ["keepany-selfhost-endpoint", "keepany-sync-access-mode", "apiKey", "keepany-official-workspace:old"])
    expect(api.isPlatformSettingKey(key)).toBe(false);
  expect(() => api.validatePlatformSetting("keepany-language", "fr")).toThrow();
  expect(() => api.validatePlatformSetting("keepany-ai-settings-v1", JSON.stringify({ provider: "openai", baseURL: "https://api.example/v1", model: "test", keySource: "session", apiKey: "synthetic-secret" }))).toThrow();
  const values = new Map<string, string>([["keepany-language", "zh-CN"]]);
  const unregister = api.registerPlatformSettings({ getItem: key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, removeItem: async key => { values.delete(key); } });
  try {
    expect(api.getPlatformSetting("keepany-language")).toBe("zh-CN");
    await api.setPlatformSetting("keepany-language", "en");
    expect(api.getPlatformSetting("keepany-language")).toBe("en");
    await api.removePlatformSetting("keepany-language");
    expect(api.getPlatformSetting("keepany-language")).toBeNull();
  } finally { unregister(); }
});
