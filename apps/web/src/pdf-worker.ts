// Keep the main thread and this independent realm on the same official shim.
import "core-js/actual/promise/with-resolvers.js";
export { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
