import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerClipboardReadHandler, registerClipboardWriteHandler } from "../../web/src/clipboard-access";
import { registerFileDeliveryHandler } from "../../web/src/file-delivery";
import { registerNativeMetadataHandler } from "../../web/src/intake-url";
import { registerPlatformSettings } from "../../web/src/platform-settings";
import "@xyflow/react/dist/style.css";
import "../../web/src/styles.css";
import "../../web/src/route-load-error.css";
import "./desktop-scroll.css";

registerPlatformSettings({
  getItem: key => {
    try { return localStorage.getItem(key); }
    catch { return null; }
  },
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => localStorage.removeItem(key),
});
registerClipboardReadHandler(readText);
registerClipboardWriteHandler(writeText);
registerFileDeliveryHandler(async ({ name, bytes }) => {
  const saved = await invoke<boolean>("save_export", bytes, {
    headers: { "x-keepany-export-name": name },
  });
  return { status: saved ? "saved" : "cancelled" };
}, "save");

// The static bundle has no local web server. Keep the existing editable URL preview fallback.
registerNativeMetadataHandler(async () => { throw Error("metadata-unavailable"); });

await import("../../web/src/i18n");
const { router } = await import("../../web/src/router");
createRoot(document.getElementById("root")!).render(
  <StrictMode><RouterProvider router={router} /></StrictMode>,
);
