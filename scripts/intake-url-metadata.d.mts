import type { IncomingMessage, ServerResponse } from 'node:http';
export const intakeMetadataPath: string;
export type MetadataOptions = { signal?: AbortSignal; testAllowedOrigins?: string[] };
export function isPublicMetadataAddress(address: string): boolean;
export function readUrlMetadataHtml(value: string, options?: MetadataOptions): Promise<{url: string; html: string}>;
export function createUrlMetadataHandler(expectedOrigin: string, options?: MetadataOptions): (request: Request) => Promise<Response>;
export function createUrlMetadataMiddleware(expectedOrigin: string, options?: MetadataOptions): (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;
