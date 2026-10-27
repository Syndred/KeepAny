import { build } from 'esbuild';
import { isAbsolute, join } from 'node:path';

// Use the real TanStack route tree, with only its rendering component replaced
// during this build-time inspection. Lazy page imports are never executed.
export async function readApplicationRouteContract(root) {
  const output = await build({
    stdin: {
      contents: `export { router } from ${JSON.stringify(join(root, 'apps/web/src/router.tsx'))};\nexport { kinds } from ${JSON.stringify(join(root, 'packages/domain/src/index.ts'))};`,
      resolveDir: root, loader: 'ts',
    },
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{
      name: 'keepany-application-route-contract',
      setup(build) {
        build.onResolve({ filter: /^[^./]/ }, args => isAbsolute(args.path) ? undefined : ({ path: import.meta.resolve(args.path), external: true }));
        build.onResolve({ filter: /^\.\/AppShell$/ }, () => ({ path: 'AppShell', namespace: 'preview-route-shell' }));
        build.onLoad({ filter: /.*/, namespace: 'preview-route-shell' }, () => ({ contents: 'export const AppShell = () => null;', loader: 'js' }));
        build.onResolve({ filter: /^\.\/(?:page-|MobileMorePage$)/ }, args => ({ path: args.path, external: true }));
      },
    }],
  });
  const { router, kinds } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
  const paths = [...new Set(Object.values(router.routesById).filter(route => route.id !== '__root__').map(route => route.fullPath))].sort();
  if (!paths.includes('/') || paths.some(path => typeof path !== 'string' || !/^\/(?:[\w$-]+\/?)*$/.test(path))) {
    throw Error('Unsupported application route pattern; extend the portable route contract before packaging.');
  }
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => !/^[a-z][a-z-]*$/.test(kind))) throw Error('Invalid application asset kinds');
  return { source: 'apps/web/src/router.tsx real TanStack route tree', paths, parameters: { kind: kinds } };
}
