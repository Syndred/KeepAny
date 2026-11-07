import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../web/src", import.meta.url)) } },
  publicDir: "../web/public",
  build: {
    target: ["chrome111", "safari17"],
    license: { fileName: "third-party-notices.md" },
  },
});
