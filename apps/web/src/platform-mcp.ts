import type { NativeMcpSession, NativeMcpSessionOptions } from '../../../packages/platform-native/src/native-mcp-session';

export interface PlatformMcpAdapter {
  prepare(options: Omit<NativeMcpSessionOptions, 'loadContext'>): Promise<NativeMcpSession>;
}
let adapter: PlatformMcpAdapter | undefined;
export function registerPlatformMcp(value: PlatformMcpAdapter): () => void {
  adapter = value; return () => { if (adapter === value) adapter = undefined; };
}
export function getPlatformMcp(): PlatformMcpAdapter | undefined { return adapter; }
