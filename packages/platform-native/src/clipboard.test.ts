import { afterEach, expect, it, vi } from 'vitest';
const plugin = vi.hoisted(() => ({ read: vi.fn(), available: vi.fn(() => true) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isPluginAvailable: plugin.available } }));
vi.mock('@capacitor/clipboard', () => ({ Clipboard: { read: plugin.read } }));
vi.mock('./index', () => ({ nativePlatform: () => 'android' }));
import { readNativeClipboardText } from './clipboard';
afterEach(() => { vi.clearAllMocks(); plugin.available.mockReturnValue(true); });

it('reads text only when explicitly invoked and preserves whitespace', async () => {
  plugin.read.mockResolvedValue({ type: 'text/plain', value: '  fictional\ntext  ' });
  expect(plugin.read).not.toHaveBeenCalled();
  expect(await readNativeClipboardText()).toBe('  fictional\ntext  ');
  expect(plugin.read).toHaveBeenCalledOnce();
});
it('accepts an empty clipboard but rejects non-text clipboard payloads', async () => {
  plugin.read.mockResolvedValueOnce({ type: '', value: '' });
  expect(await readNativeClipboardText()).toBe('');
  plugin.read.mockResolvedValueOnce({ type: 'image/png', value: 'fictional-image-payload' });
  await expect(readNativeClipboardText()).rejects.toThrow('native-clipboard-format');
});
it('does not call a missing native plugin', async () => {
  plugin.available.mockReturnValue(false);
  await expect(readNativeClipboardText()).rejects.toThrow('native-clipboard-unavailable');
  expect(plugin.read).not.toHaveBeenCalled();
});
