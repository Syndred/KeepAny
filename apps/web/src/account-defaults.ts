import type { AccountCardMember } from './account-card-groups';

export const ACCOUNT_DEFAULTS_ID = 'keepany-account-defaults-v1';
/** Most recently chosen opaque card IDs; no credential metadata is persisted. */
export function parseAccountDefaults(value: unknown): string[] {
 if (!Array.isArray(value) || value.length > 1000 || value.some(id => typeof id !== 'string' || !id || id.length > 256 || id.trim() !== id || /[\u0000-\u001f\u007f-\u009f]/.test(id))) return [];
 return [...new Set(value as string[])];
}
export function defaultAccountId(members: readonly AccountCardMember[], defaults: readonly string[]): string | undefined {
 const live = new Set(members.map(member => member.asset.id));
 return defaults.find(id => live.has(id)) ?? members[0]?.asset.id;
}
export function chooseAccountDefault(members: readonly AccountCardMember[], defaults: readonly string[], id: string): string[] {
 const live = new Set(members.map(member => member.asset.id));
 if (!live.has(id)) throw Error('asset-stale');
 return [id, ...defaults.filter(value => !live.has(value))].slice(0, 1000);
}
