import { App } from '@capacitor/app';
import { nativePlatform } from './index';

export async function installNativeLifecycle(): Promise<() => Promise<void>> {
  nativePlatform();
  let active = true;
  const publishState = (next: boolean) => {
    if (active === next) return;
    active = next;
    window.dispatchEvent(new Event(next ? 'keepany-native-foreground' : 'keepany-native-background'));
  };
  const state = await App.addListener('appStateChange', ({ isActive }) => {
    publishState(isActive);
  });
  // Android may pause and resume before onStop/appStateChange runs. Lock at
  // that first pause, including system pickers, instead of waiting for a stop.
  const pause = await App.addListener('pause', () => publishState(false));
  const resume = await App.addListener('resume', () => publishState(true));
  const back = await App.addListener('backButton', async ({ canGoBack }) => {
    // Base UI marks open popups with data-open; portal order puts nested
    // menus/selects after their containing dialog. Close only the top layer.
    const layers = [...document.querySelectorAll<HTMLElement>(
      '[data-open][role="dialog"], [data-open][role="alertdialog"], [data-open][role="menu"], [data-open][role="listbox"]',
    )];
    const top = layers.at(-1);
    if (top) {
      top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      return;
    }
    // Shared-shell surfaces (navigation/search) are not Base UI popups.
    // Let them consume one back press before leaving the current route/app.
    const shellBack = new Event('keepany-native-back', { cancelable: true });
    window.dispatchEvent(shellBack);
    if (shellBack.defaultPrevented) return;
    if (canGoBack) window.history.back();
    else await App.minimizeApp();
  });
  return async () => { await state.remove(); await pause.remove(); await resume.remove(); await back.remove(); };
}
