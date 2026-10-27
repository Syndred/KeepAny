import { App } from '@capacitor/app';
import { nativePlatform } from './index';

export async function installNativeLifecycle(): Promise<() => Promise<void>> {
  nativePlatform();
  const state = await App.addListener('appStateChange', ({ isActive }) => {
    window.dispatchEvent(new Event(isActive ? 'keepany-native-foreground' : 'keepany-native-background'));
  });
  const back = await App.addListener('backButton', async ({ canGoBack }) => {
    const dialog = document.querySelector('[role="dialog"][data-state="open"]');
    if (dialog) {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return;
    }
    if (canGoBack) window.history.back();
    else await App.minimizeApp();
  });
  return async () => { await state.remove(); await back.remove(); };
}
