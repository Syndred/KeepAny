import { fileURLToPath } from 'node:url';
import type { UserConfig } from 'vite';

const pdfWorkerEntry = fileURLToPath(new URL('./src/pdf-worker.ts', import.meta.url)).replaceAll('\\', '/');

export const pdfWorkerOptions: NonNullable<UserConfig['worker']> = {
  format: 'es',
  plugins: () => [{
    name: 'keepany-pdf-worker-exports',
    options(options) {
      if (typeof options.input !== 'string' || options.input.replaceAll('\\', '/') !== pdfWorkerEntry) return options;
      // Vite 8 removes worker entry exports by default. PDF.js's fallback
      // import needs its public WorkerMessageHandler namespace.
      return { ...options, preserveEntrySignatures: 'strict' };
    },
  }],
};
