import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { assertPersistentUri, nativePlatform } from '../../platform-native/src';

export type SqlValue = string | number | null;
export type SqlRow = Record<string, unknown>;
export interface SqlDriver {
  readonly uri: string;
  execute(sql: string): Promise<void>;
  query<T extends SqlRow = SqlRow>(sql: string, values?: SqlValue[]): Promise<T[]>;
  run(sql: string, values?: SqlValue[]): Promise<number>;
  close(): Promise<void>;
}
let nativeConnections: Promise<SQLiteConnection> | undefined;
function connectionManager(): Promise<SQLiteConnection> {
  if (!nativeConnections) nativeConnections = (async () => {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    // A WebView reload discards JS handles while the native plugin can retain
    // open connections. Reconcile once at bootstrap, then share the manager for
    // all datasets; never close other live datasets on each new connection.
    await sqlite.checkConnectionsConsistency();
    return sqlite;
  })().catch(error => { nativeConnections = undefined; throw error; });
  return nativeConnections;
}

export async function openNativeDriver(name: string): Promise<SqlDriver> {
  nativePlatform();
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(name)) throw Error('database-name');
  if (!Capacitor.isPluginAvailable('CapacitorSQLite')) throw Error('native-sqlite-unavailable');
  const sqlite = await connectionManager();
  const connection = await sqlite.createConnection(name, false, 'no-encryption', 1, false);
  try {
    await connection.open();
    const { url } = await connection.getUrl();
    if (!url) throw Error('native-storage-location');
    assertPersistentUri(url.startsWith('file:') ? url : `file://${url}`);
    // Each high-level operation owns its SQL transaction. Plugin helpers must
    // not open an additional implicit transaction around individual statements.
    // Android's execSQL rejects PRAGMAs that return rows. WAL negotiation is a
    // query; only the non-row settings belong to execute.
    const mode = await connection.query('PRAGMA journal_mode=WAL');
    await connection.execute('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;', false);
    const durability = await connection.query('PRAGMA synchronous');
    if (mode.values?.[0]?.journal_mode !== 'wal' || durability.values?.[0]?.synchronous !== 2) throw Error('native-sqlite-durability');
    return {
      uri: url,
      async execute(sql) { await connection.execute(sql, false); },
      async query<T extends SqlRow>(sql: string, values: SqlValue[] = []) {
        return (await connection.query(sql, values)).values as T[] ?? [];
      },
      async run(sql, values = []) { return (await connection.run(sql, values, false)).changes?.changes ?? 0; },
      async close() { await sqlite.closeConnection(name, false); },
    };
  } catch (error) {
    await sqlite.closeConnection(name, false).catch(() => {});
    throw error;
  }
}
