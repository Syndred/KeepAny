import "fake-indexeddb/auto";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

/** Rebind APIs captured before a worker installed the Node fixture globals. */
export function initializeNodeIndexedDB() {
	Dexie.dependencies.indexedDB = indexedDB;
	Dexie.dependencies.IDBKeyRange = IDBKeyRange;
}
