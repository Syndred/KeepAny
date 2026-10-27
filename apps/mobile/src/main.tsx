import { createRoot } from 'react-dom/client';
import { nativePlatform } from '../../../packages/platform-native/src';
import { openNativeRepository } from '../../../packages/local-db-native/src';
import { installNativeLifecycle } from '../../../packages/platform-native/src/lifecycle';
import { registerRepositoryFactory, localRepository } from '../../../packages/local-db/src';
import { registerFileDeliveryHandler } from '../../web/src/file-delivery';
import { exportNativeFile } from '../../../packages/platform-native/src/export-file';
import '../../../apps/web/src/styles.css';
import i18n from '../../web/src/i18n';

for (const [language, copy] of Object.entries({
  'zh-CN': { mobileLocalOpenFailed: '本机资料暂时无法打开。请重试。', mobileRetry: '重试' },
  en: { mobileLocalOpenFailed: 'Your local data could not be opened. Please try again.', mobileRetry: 'Try again' },
})) i18n.addResourceBundle(language, 'translation', copy, true, true);
const rootElement = document.getElementById('root');
if (!rootElement) throw Error('missing-app-root');
const reactRoot = createRoot(rootElement);

async function start() {
  nativePlatform();
  registerFileDeliveryHandler(exportNativeFile);
  registerRepositoryFactory(() => openNativeRepository());
  await localRepository();
  await installNativeLifecycle();
  const [{ RouterProvider }, { router }] = await Promise.all([
    import('@tanstack/react-router'), import('../../web/src/router'),
  ]);
  await import('@xyflow/react/dist/style.css');
  reactRoot.render(<RouterProvider router={router} />);
}
void start().catch(() => {
  reactRoot.render(
    <main className="page"><h1>KeepAny</h1><p role="alert">{i18n.t('mobileLocalOpenFailed')}</p>
      <button type="button" onClick={() => location.reload()}>{i18n.t('mobileRetry')}</button></main>,
  );
});
