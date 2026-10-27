import { createContext, useContext } from 'react';
import type { BrowserAuditEntry } from '../../../packages/mcp/src/browser-bridge';
import type { BridgeScope } from '../../../packages/mcp/src/bridge';
import type { ReadField, WriteField } from '../../../packages/mcp/src/fields';
import type { MobileMcpClientRequest, MobileMcpPairingFile, MobileMcpScope } from '../../../packages/mcp/src/mobile-pairing';
import type { FileDeliveryMessage } from './file-delivery';

export type McpRequest = {
  kind: 'keepany-mcp-local-request-v1'; appOrigin: string; assetIds: string[];
  readFields: ReadField[]; writeFields: WriteField[]; ttlMs: number; createdAt: number; requestNonce: string;
};
export type McpStatus = 'idle' | 'pairing' | 'connected' | 'error';
export type RequestInput = Pick<McpRequest, 'assetIds' | 'readFields' | 'writeFields' | 'ttlMs'>;
export type NativeMcpPhase = 'idle' | 'preparing' | 'prepared' | 'activating' | 'waiting' | 'authorized' | 'error';
export interface NativeMcpRuntime {
  phase: NativeMcpPhase;
  preparedFile: MobileMcpPairingFile | null;
  delivered: boolean;
  pendingClient: MobileMcpClientRequest | null;
  prepare(address: string, scope: MobileMcpScope): Promise<void>;
  reportDelivery(message: FileDeliveryMessage): void;
  activate(): Promise<void>;
  decideClient(approved: boolean): Promise<void>;
}
export interface McpRuntime {
  localConnectionAvailable: boolean; status: McpStatus; scope: BridgeScope | null; expiresAt: number | null;
  audit: BrowserAuditEntry[]; revokedAt: number | null; refreshAudit(): Promise<void>;
  prepared: McpRequest | null; error: string | null; prepare(input: RequestInput): void;
  invalidatePrepared(): void; importPairing(file: File): Promise<void>; revoke(): Promise<void>;
  native?: NativeMcpRuntime;
}
export const McpRuntimeContext = createContext<McpRuntime | null>(null);
export function useMcpRuntime(): McpRuntime {
  const value = useContext(McpRuntimeContext);
  if (!value) throw Error('missing-mcp-runtime');
  return value;
}
