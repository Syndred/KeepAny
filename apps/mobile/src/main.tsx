import { createRoot } from 'react-dom/client';
import { nativePlatform } from '../../../packages/platform-native/src';
import { openNativeDatasetManager } from '../../../packages/local-db-native/src';
import { installNativeLifecycle } from '../../../packages/platform-native/src/lifecycle';
import { registerRepositoryFactory, localRepository } from '../../../packages/local-db/src';
import { registerFileDeliveryHandler } from '../../web/src/file-delivery';
import { exportNativeFile } from '../../../packages/platform-native/src/export-file';
import { hydrateNativePreferences } from '../../../packages/platform-native/src/preferences';
import { registerPlatformSettings } from '../../web/src/platform-settings';
import { registerDatasetAdapter } from '../../web/src/native-datasets';
import { registerNativeMetadataHandler } from '../../web/src/intake-url';
import { readNativeMetadataHtml } from '../../../packages/platform-native/src/metadata';
import { registerBindingRepositoryFactory } from '../../../packages/binding/src/store';
import { createNativeBindingRepository } from '../../../packages/platform-native/src/native-binding';
import { registerPlatformBinding } from '../../web/src/platform-binding';
import { createNativeBindingPlatform, createNativeSyncFetchFactory } from '../../../packages/platform-native/src/binding-transport';
import { registerSyncFetchFactory } from '../../../packages/sync-client/src/platform-fetch';
import { createNativeConnections } from '../../../packages/platform-native/src/connections';
import { registerPlatformConnections } from '../../web/src/platform-connections';
import { registerAiFetchFactory } from '../../../packages/ai/src';
import { createNativeAiFetchFactory } from '../../../packages/platform-native/src/ai-transport';
import { createNativeMcpPlatform } from '../../../packages/platform-native/src/native-mcp-platform';
import { resetNativeMcpTransport } from '../../../packages/platform-native/src/native-mcp-transport';
import { registerPlatformMcp } from '../../web/src/platform-mcp';
import { RxdbMcpAssetStore } from '../../../packages/mcp/src/rxdb-store';
import { Capacitor } from '@capacitor/core';
import '../../../apps/web/src/styles.css';

const startupCopy = {
  'zh-CN': { mobileLocalOpenFailed: '本机资料暂时无法打开。请重试。', mobileRetry: '重试', mobileOpening: '正在打开本机资料…' },
  en: { mobileLocalOpenFailed: 'Your local data could not be opened. Please try again.', mobileRetry: 'Try again', mobileOpening: 'Opening your local data…' },
};
type StartupKey = keyof typeof startupCopy.en;
type StartupStage = 'platform' | 'preferences' | 'translations' | 'adapters' | 'datasets' | 'repository' | 'lifecycle' | 'router';
let startupStage: StartupStage = 'platform';
let translate = (key: StartupKey) => startupCopy[navigator.language.startsWith('zh') ? 'zh-CN' : 'en'][key];
const rootElement = document.getElementById('root');
if (!rootElement) throw Error('missing-app-root');
const reactRoot = createRoot(rootElement);
reactRoot.render(<main className="page"><h1>KeepAny</h1><p role="status">{translate('mobileOpening')}</p></main>);

async function start() {
  nativePlatform();
  // Attempt stale WebView IO cleanup even if local-data startup later fails.
  // MCP is optional: this failure must not prevent opening ordinary records.
  // Its factory independently requires an acknowledged reset before any IO.
  void resetNativeMcpTransport().catch(() => {});
  startupStage = 'preferences';
  registerPlatformSettings(await hydrateNativePreferences());
  startupStage = 'translations';
  const { default: i18n } = await import('../../web/src/i18n');
  for (const [language, copy] of Object.entries(startupCopy)) i18n.addResourceBundle(language, 'translation', copy, true, true);
  translate = key => i18n.t(key);
  startupStage = 'adapters';
  registerFileDeliveryHandler(exportNativeFile);
  registerNativeMetadataHandler(readNativeMetadataHtml);
  registerBindingRepositoryFactory(createNativeBindingRepository);
  registerPlatformBinding(createNativeBindingPlatform(import.meta.env.VITE_KEEPANY_BINDING_ISSUER, import.meta.env.VITE_KEEPANY_OFFICIAL_SYNC_ORIGIN));
  const connections = createNativeConnections();
  registerPlatformConnections(connections);
  registerAiFetchFactory(createNativeAiFetchFactory());
  registerSyncFetchFactory(createNativeSyncFetchFactory(connections.sessionFetch));
  startupStage = 'datasets';
  const datasets = await openNativeDatasetManager();
  let datasetEpoch = 0;
  datasets.subscribe(event => { if (event === 'active') datasetEpoch++; });
  registerDatasetAdapter(datasets);
  registerRepositoryFactory(() => datasets.openActive());
  startupStage = 'repository';
  await localRepository();
  if (Capacitor.isPluginAvailable('KeepAnyMcpAuthority') && Capacitor.isPluginAvailable('KeepAnyMcpTransport')) {
    registerPlatformMcp(createNativeMcpPlatform({ loadContext: async () => {
      const epoch = datasetEpoch;
      const active = (await datasets.list()).filter(dataset => dataset.active);
      if (active.length !== 1) throw Error('mcp-native-dataset-unavailable');
      const repository = await localRepository();
      const assertCurrent = () => { if (datasetEpoch !== epoch) throw Error('mcp-native-dataset-changed'); };
      assertCurrent();
      return { datasetName: active[0].name, store: new RxdbMcpAssetStore(repository), assertCurrent,
        onInvalidated: listener => datasets.subscribe(event => { if (event === 'active') listener(); }) };
    } }));
  }
  datasets.subscribe(event => { if (event === 'active') location.reload(); });
  startupStage = 'lifecycle';
  await installNativeLifecycle();
  startupStage = 'router';
  const [{ RouterProvider }, { router }] = await Promise.all([
    import('@tanstack/react-router'), import('../../web/src/router'),
  ]);
  await import('@xyflow/react/dist/style.css');
  reactRoot.render(<RouterProvider router={router} />);
}
void start().catch((error: unknown) => {
  const code = error instanceof Error && /^(?:native|repository|database)-[a-z-]+$/.test(error.message) ? error.message : 'startup-failed';
  // Fixed stage metadata only: never expose plugin messages, paths or values.
  console.error('KeepAny startup:', code, startupStage);
  reactRoot.render(
    <main className="page" data-startup-stage={startupStage}><h1>KeepAny</h1><p role="alert">{translate('mobileLocalOpenFailed')}</p>
      <button type="button" onClick={() => location.reload()}>{translate('mobileRetry')}</button></main>,
  );
});
