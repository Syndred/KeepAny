import type { AccountCardMember } from './account-card-groups';

export const ACCOUNT_ORDER_ID = 'keepany-account-order-v1';
/** Store only a bounded list of opaque card IDs, never names or credential metadata. */
export function parseAccountOrder(value: unknown): string[] {
 if (!Array.isArray(value) || value.length > 1000 || value.some(id => typeof id !== 'string' || !id || id.length > 256 || id.trim() !== id || /[\u0000-\u001f\u007f-\u009f]/.test(id))) return [];
 return [...new Set(value as string[])];
}
export function orderedAccountMembers(members: readonly AccountCardMember[], order: readonly string[]): AccountCardMember[] {
 const positions = new Map(order.map((id, index) => [id, index]));
 return members.map((member, index) => ({ member, index })).sort((a, b) => (positions.get(a.member.asset.id) ?? order.length + a.index) - (positions.get(b.member.asset.id) ?? order.length + b.index)).map(row => row.member);
}

/** Refill only peer slots so the account currently being viewed keeps its exact cycle position. */
export function reorderAccountPeers(members: readonly AccountCardMember[], previousOrder: readonly string[], currentId: string, activeId: string, overId: string): string[] {
 const ids = members.map(member => member.asset.id);
 const live = new Set(ids);
 if (!live.has(currentId) || activeId === currentId || overId === currentId || !live.has(activeId) || !live.has(overId)) throw Error('asset-stale');
 const peers = ids.filter(id => id !== currentId);
 const nextPeers = [...peers];
 nextPeers.splice(nextPeers.indexOf(overId), 0, ...nextPeers.splice(nextPeers.indexOf(activeId), 1));
 let peerIndex = 0;
 const nextMembers = ids.map(id => id === currentId ? id : nextPeers[peerIndex++]);
 // Preserve unrelated and temporarily absent IDs in their existing slots.
 const complete = [...previousOrder, ...ids.filter(id => !previousOrder.includes(id))];
 if (complete.length > 1000) throw Error('account-order-limit');
 let memberIndex = 0;
 return complete.map(id => live.has(id) ? nextMembers[memberIndex++] : id);
}
