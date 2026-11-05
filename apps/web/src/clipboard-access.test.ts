import { afterEach, expect, it, vi } from 'vitest';
import { readClipboardText, registerClipboardReadHandler } from './clipboard-access';
let unregister: (() => void) | undefined;
afterEach(() => { unregister?.(); unregister = undefined; vi.unstubAllGlobals(); });

it('uses the browser clipboard until a native handler is registered', async () => {
  const readText = vi.fn().mockResolvedValue('browser text');
  vi.stubGlobal('navigator', { clipboard: { readText } });
  expect(await readClipboardText()).toBe('browser text');
  const native = vi.fn().mockResolvedValue('native text');
  unregister = registerClipboardReadHandler(native);
  expect(native).not.toHaveBeenCalled();
  expect(await readClipboardText()).toBe('native text');
  expect(readText).toHaveBeenCalledOnce();
  expect(() => registerClipboardReadHandler(native)).toThrow('clipboard-already-registered');
  unregister();
  expect(await readClipboardText()).toBe('browser text');
});

it('does not fall back to another clipboard after a native read fails', async () => {
  const readText = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { readText } });
  unregister = registerClipboardReadHandler(async () => { throw Error('native-clipboard-unavailable'); });
  await expect(readClipboardText()).rejects.toThrow('native-clipboard-unavailable');
  expect(readText).not.toHaveBeenCalled();
});

it('discards a pending read after background or unregister, even after returning foreground', async () => {
  vi.stubGlobal('window', new EventTarget());
  let complete!: (text: string) => void;
  const handler = () => new Promise<string>(resolve => { complete = resolve; });
  unregister = registerClipboardReadHandler(handler);
  const pending = readClipboardText();
  window.dispatchEvent(new Event('keepany-native-background'));
  window.dispatchEvent(new Event('keepany-native-foreground'));
  complete('fictional clipboard text');
  await expect(pending).rejects.toThrow('clipboard-read-cancelled');
  const second = readClipboardText();
  unregister();
  complete('fictional clipboard text');
  await expect(second).rejects.toThrow('clipboard-read-cancelled');
});
