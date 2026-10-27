import { Capacitor } from '@capacitor/core';
import { AiClientError } from '../../../packages/ai/src';

/** Only the AI client's stable typed timeout is classified; provider text is never shown. */
export function aiRequestErrorKey(error: unknown, surface: 'workspace' | 'settings', native = Capacitor.isNativePlatform()): string {
  if (error instanceof AiClientError && error.code === 'timeout') return 'aiRequestTimeout';
  if (native) return 'aiNativeRequestFailed';
  return surface === 'settings' ? 'aiSettingsTestFailed' : 'aiError';
}
