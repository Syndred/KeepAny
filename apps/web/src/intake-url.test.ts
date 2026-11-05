import { afterEach, expect, it, vi } from "vitest";
import * as metadata from "./intake-url";
afterEach(() => vi.unstubAllGlobals());
it("uses the native bridge exclusively and validates redirect results", async () => {
  expect(metadata.registerNativeMetadataHandler, "native metadata bridge is required").toBeTypeOf("function");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("document", { createElement: () => ({ innerHTML: "", content: { querySelectorAll: () => [], querySelector: () => ({ textContent: "Synthetic page" }) } }) });
  const handler = vi.fn(async () => ({ url: "https://page.example/final#fragment", html: "<title>Synthetic page</title>" }));
  const old = metadata.registerNativeMetadataHandler(async () => { throw Error("metadata-unavailable"); });
  const dispose = metadata.registerNativeMetadataHandler(handler); old();
  try {
    const signal = new AbortController().signal;
    await expect(metadata.readUrlMetadata("https://page.example/#fragment", { signal })).resolves.toEqual({ url: "https://page.example/final", title: "Synthetic page", description: "" });
    expect(handler).toHaveBeenCalledWith("https://page.example/", { signal });
    expect(fetch).not.toHaveBeenCalled();
    handler.mockResolvedValueOnce({ url: "file:///private", html: "" });
    await expect(metadata.readUrlMetadata("https://page.example")).rejects.toThrow("metadata-invalid");
    handler.mockRejectedValueOnce(Error("metadata-private"));
    await expect(metadata.readUrlMetadata("https://page.example")).rejects.toThrow("metadata-private");
    expect(fetch).not.toHaveBeenCalled();
  } finally { dispose(); }
});
