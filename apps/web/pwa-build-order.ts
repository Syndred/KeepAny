import type { VitePWAOptions } from 'vite-plugin-pwa';

function compareUrls(a: string | { url: string }, b: string | { url: string }): number {
  const left = typeof a === 'string' ? a : a.url;
  const right = typeof b === 'string' ? b : b.url;
  // Code unit order must not depend on the filesystem's case rules or locale.
  return left < right ? -1 : left > right ? 1 : 0;
}

export const deterministicPwaBuild = {
  workbox: {
    maximumFileSizeToCacheInBytes: 5_000_000,
    manifestTransforms: [async entries => ({
      manifest: [...entries].sort(compareUrls),
      warnings: [],
    })],
  },
  integration: {
    beforeBuildServiceWorker(options) {
      // Workbox appends these after custom transforms. The plugin has now added
      // public icons and the web manifest, so their order must be fixed here.
      options.workbox.additionalManifestEntries?.sort(compareUrls);
    },
  },
} satisfies Pick<VitePWAOptions, 'workbox' | 'integration'>;
