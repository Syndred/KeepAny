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
import { registerAiFetchFactory } from '../../../packages/ai/src';
import { createNativeAiFetchFactory } from '../../../packages/platform-native/src/ai-transport';
import { registerClipboardReadHandler } from '../../web/src/clipboard-access';
import { readNativeClipboardText } from '../../../packages/platform-native/src/clipboard';
import '../../web/src/styles.css';
import '../../web/src/route-load-error.css';

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
const root = createRoot(rootElement);
root.render(<main className="page"><h1>KeepAny</h1><p role="status">{translate('mobileOpening')}</p></main>);

async function start() {
  nativePlatform();
  startupStage = 'preferences';
  registerPlatformSettings(await hydrateNativePreferences());
  startupStage = 'translations';
  const { default: i18n } = await import('../../web/src/i18n');
  for (const [language, copy] of Object.entries(startupCopy)) i18n.addResourceBundle(language, 'translation', copy, true, true);
  translate = key => i18n.t(key);
  startupStage = 'adapters';
  registerFileDeliveryHandler(exportNativeFile);
  registerClipboardReadHandler(readNativeClipboardText);
  registerNativeMetadataHandler(readNativeMetadataHtml);
  registerAiFetchFactory(createNativeAiFetchFactory());
  startupStage = 'datasets';
  const datasets = await openNativeDatasetManager();
  registerDatasetAdapter(datasets);
  registerRepositoryFactory(() => datasets.openActive());
  startupStage = 'repository';
  await localRepository();
  datasets.subscribe(event => { if (event === 'active') location.reload(); });
  startupStage = 'lifecycle';
  await installNativeLifecycle();
  startupStage = 'router';
  const [{ RouterProvider }, { router }] = await Promise.all([
    import('@tanstack/react-router'), import('../../web/src/router'),
  ]);
  await import('@xyflow/react/dist/style.css');
  root.render(<RouterProvider router={router} />);
}

void start().catch((error: unknown) => {
  const code = error instanceof Error && /^(?:native|repository|database)-[a-z-]+$/.test(error.message) ? error.message : 'startup-failed';
  // Only fixed stage metadata is logged; plugin messages and record values stay private.
  console.error('KeepAny startup:', code, startupStage);
  root.render(<main className="page" data-startup-stage={startupStage}><h1>KeepAny</h1><p role="alert">{translate('mobileLocalOpenFailed')}</p>
    <button type="button" onClick={() => location.reload()}>{translate('mobileRetry')}</button></main>);
});
