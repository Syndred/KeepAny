import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'android', plugins: true, cache: new Map<string, string>(),
  canShare: vi.fn(), share: vi.fn(), writeFile: vi.fn(), readFile: vi.fn(), getUri: vi.fn(), readdir: vi.fn(), rmdir: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: {
  getPlatform: () => mocks.platform,
  isNativePlatform: () => mocks.platform !== 'web',
  isPluginAvailable: () => mocks.plugins,
} }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE', LibraryNoCloud: 'LIBRARY_NO_CLOUD' },
  Filesystem: { writeFile: mocks.writeFile, readFile: mocks.readFile, getUri: mocks.getUri, readdir: mocks.readdir, rmdir: mocks.rmdir },
}));
vi.mock('@capacitor/share', () => ({ Share: { canShare: mocks.canShare, share: mocks.share } }));

import { exportNativeFile } from './export-file';

const input = () => ({ name: 'keepany-synthetic.ka1', mimeType: 'application/octet-stream', bytes: new Uint8Array([75, 69, 69, 80, 65, 78, 89, 49, 0, 255]) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform = 'android'; mocks.plugins = true; mocks.cache.clear();
  mocks.canShare.mockResolvedValue({ value: true });
  mocks.share.mockResolvedValue({ activityType: 'synthetic-target' });
  mocks.readdir.mockResolvedValue({ files: [] });
  mocks.writeFile.mockImplementation(async ({ path, data }: { path: string; data: string }) => { mocks.cache.set(path, data); });
  mocks.readFile.mockImplementation(async ({ path }: { path: string }) => ({ data: mocks.cache.get(path) }));
  mocks.getUri.mockImplementation(async ({ path }: { path: string }) => ({ uri: `file:///app/cache/${path}` }));
  mocks.rmdir.mockImplementation(async ({ path }: { path: string }) => {
    for (const key of mocks.cache.keys()) if (key.startsWith(`${path}/`)) mocks.cache.delete(key);
  });
});

describe('native generated-file delivery (plugin contract mocks, not device proof)', () => {
  it('writes only cache, verifies bytes, preserves the filename and never claims external save', async () => {
    await expect(exportNativeFile(input())).resolves.toEqual({ status: 'opened' });
    const write = mocks.writeFile.mock.calls[0][0];
    expect(write.directory).toBe('CACHE');
    expect(write.path).toMatch(/^exports\/[0-9a-f-]{36}\/keepany-synthetic\.ka1$/);
    expect(mocks.readFile).toHaveBeenCalledWith({ path: write.path, directory: 'CACHE' });
    expect(mocks.share).toHaveBeenCalledWith({ title: 'keepany-synthetic.ka1', files: [`file:///app/cache/${write.path}`] });
    expect(mocks.cache.size).toBe(1);
    expect(mocks.rmdir).not.toHaveBeenCalled();
  });

  it('recognizes the pinned native cancellation and removes its temporary directory', async () => {
    mocks.share.mockRejectedValueOnce({ message: 'Share canceled' });
    await expect(exportNativeFile(input())).resolves.toEqual({ status: 'cancelled' });
    expect(mocks.cache.size).toBe(0);
    expect(mocks.rmdir).toHaveBeenCalledWith({ path: expect.stringMatching(/^exports\/[0-9a-f-]{36}$/), directory: 'CACHE', recursive: true });
  });

  it.each(['length', 'same-length'])('rejects %s readback corruption before opening any share target', async kind => {
    const damaged = kind === 'length' ? new Uint8Array([1]) : input().bytes.map(byte => byte ^ 1);
    mocks.readFile.mockResolvedValueOnce({ data: btoa(String.fromCharCode(...damaged)) });
    await expect(exportNativeFile(input())).rejects.toThrow('native-export-readback');
    expect(mocks.share).not.toHaveBeenCalled();
    expect(mocks.cache.size).toBe(0);
  });

  it('never opens a share target when a cache write fails, and can retry', async () => {
    mocks.writeFile.mockRejectedValueOnce(Error('synthetic-no-space'));
    await expect(exportNativeFile(input())).rejects.toThrow('synthetic-no-space');
    expect(mocks.share).not.toHaveBeenCalled();
    expect(mocks.writeFile).toHaveBeenCalledWith(expect.objectContaining({ directory: 'CACHE' }));
    await expect(exportNativeFile(input())).resolves.toEqual({ status: 'opened' });
  });

  it('rejects Web fallback, missing plugins and unavailable system sharing', async () => {
    mocks.platform = 'web';
    await expect(exportNativeFile(input())).rejects.toThrow('native-platform-required');
    mocks.platform = 'ios'; mocks.plugins = false;
    await expect(exportNativeFile(input())).rejects.toThrow('native-export-unavailable');
    mocks.plugins = true; mocks.canShare.mockResolvedValueOnce({ value: false });
    await expect(exportNativeFile(input())).rejects.toThrow('native-export-unavailable');
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('does not share unsupported paths, extensions or empty bytes', async () => {
    for (const name of ['../private.kdbx', 'folder\\private.kdbx', 'file:secret.ka1', 'plain.txt']) {
      await expect(exportNativeFile({ ...input(), name })).rejects.toThrow('native-export-invalid');
    }
    await expect(exportNativeFile({ ...input(), bytes: new Uint8Array() })).rejects.toThrow('native-export-invalid');
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('copies bytes before waiting and rejects concurrent exports until the sheet finishes', async () => {
    let finish!: (result: { activityType: string }) => void;
    mocks.share.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const request = input(), before = request.bytes.slice();
    const pending = exportNativeFile(request);
    request.bytes.fill(99);
    await vi.waitFor(() => expect(mocks.share).toHaveBeenCalledOnce());
    const encoded = mocks.writeFile.mock.calls[0][0].data as string;
    expect(Uint8Array.from(atob(encoded), character => character.charCodeAt(0))).toEqual(before);
    await expect(exportNativeFile(input())).rejects.toThrow('native-export-busy');
    finish({ activityType: '' });
    await expect(pending).resolves.toEqual({ status: 'opened' });
  });

  it('prunes only old UUID export directories and keeps recent or unrelated content', async () => {
    const old = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    mocks.readdir.mockResolvedValueOnce({ files: [
      { name: old, type: 'directory', mtime: Date.now() - 2 * 24 * 60 * 60 * 1000 },
      { name: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', type: 'directory', mtime: Date.now() },
      { name: 'unrelated-directory', type: 'directory', mtime: 0 },
      { name: 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee', type: 'file', mtime: 0 },
    ] });
    await exportNativeFile(input());
    expect(mocks.rmdir).toHaveBeenCalledTimes(1);
    expect(mocks.rmdir).toHaveBeenCalledWith({ path: `exports/${old}`, directory: 'CACHE', recursive: true });
  });
});
