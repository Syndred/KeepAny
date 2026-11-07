import { afterEach, expect, it, vi } from 'vitest';
import { readClipboardText, registerClipboardReadHandler, registerClipboardWriteHandler, writeClipboardText } from './clipboard-access';
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

it('copies through the registered native writer and preserves browser behavior when removed', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const native = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('desktop-clipboard-failed'));
  const dispose = registerClipboardWriteHandler(native);
  try {
    await writeClipboardText(' fictional value ');
    expect(native).toHaveBeenCalledWith(' fictional value ');
    await expect(writeClipboardText('another fictional value')).rejects.toThrow('desktop-clipboard-failed');
    expect(writeText).not.toHaveBeenCalled();
  } finally { dispose(); }
  await writeClipboardText('browser value');
  expect(writeText).toHaveBeenCalledWith('browser value');
});
