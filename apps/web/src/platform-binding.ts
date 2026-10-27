import type { JWTVerifyGetKey } from 'jose';
import { bridgeBindingKeys, createBindingBridgeFetch } from '../../../packages/binding/src/bridge';
import { BindingTransport } from '../../../packages/binding/src/remote';

export interface BindingClient { transport: BindingTransport; keys: JWTVerifyGetKey }
export interface PlatformBindingAdapter {
  configured(issuer: unknown): boolean;
  client(issuer: string): BindingClient;
  allowsResource(origin: unknown): boolean;
  resourceFetch: typeof fetch;
}
let native: PlatformBindingAdapter | undefined;

/** Installed by the native entry point before importing any settings UI. */
export function registerPlatformBinding(adapter: PlatformBindingAdapter): () => void {
  if (native) throw Error('binding-platform-registered');
  native = adapter;
  return () => { if (native === adapter) native = undefined; };
}
export function isBindingConfigured(issuer: unknown, bridge: unknown): boolean {
  return native ? native.configured(issuer) : typeof issuer === 'string' && typeof bridge === 'string';
}
export function bindingClient(issuer: unknown, bridge: unknown): BindingClient {
  if (!isBindingConfigured(issuer, bridge) || typeof issuer !== 'string') throw Error('binding-unconfigured');
  if (native) return native.client(issuer);
  return { transport: new BindingTransport(issuer, createBindingBridgeFetch(issuer, bridge as string)), keys: bridgeBindingKeys(issuer, bridge as string) };
}
export function allowsOfficialResource(origin: unknown): origin is string {
  return native ? native.allowsResource(origin) : typeof origin === 'string' && origin === window.location.origin;
}
export function fetchBindingResource(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return native ? native.resourceFetch(input, init) : fetch(input, init);
}
