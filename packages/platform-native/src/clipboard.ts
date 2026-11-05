import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { nativePlatform } from './index';

/** Text-only access. The UI's existing generation/lock guards own late results. */
export async function readNativeClipboardText(): Promise<string> {
  nativePlatform();
  if (!Capacitor.isPluginAvailable('Clipboard')) throw Error('native-clipboard-unavailable');
  const result = await Clipboard.read();
  if (typeof result.value !== 'string' || result.value && result.type !== 'text/plain') throw Error('native-clipboard-format');
  return result.value;
}
