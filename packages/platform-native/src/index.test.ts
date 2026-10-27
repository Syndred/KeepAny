import { expect, it } from 'vitest';
import { assertPersistentUri, nativePlatform } from './index';

it('rejects Web fallback and cache/tmp paths', () => {
  expect(() => nativePlatform()).toThrow('native-platform-required');
  for (const uri of ['http://localhost/db', 'file:///data/user/0/app/cache/keepany.db', 'file:///Library/Caches/db', 'file:///tmp/db']) expect(() => assertPersistentUri(uri)).toThrow('native-storage-location');
  expect(() => assertPersistentUri('file:///data/user/0/app/databases/keepany.db')).not.toThrow();
  expect(() => assertPersistentUri('file:///app/Library/Application%20Support/KeepAny/db')).not.toThrow();
});
