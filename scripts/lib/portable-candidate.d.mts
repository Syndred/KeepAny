export type CandidateRelease = {
  schema: "keepany.portable-preview.v1";
  sourceCommit: string;
  sourceDirty: boolean;
  version?: string;
  webFiles: Array<{ path: string; sha256: string }>;
};
export function safeCandidatePath(name: unknown): string;
export function selectCandidate(options?: { argument?: string; env?: NodeJS.ProcessEnv; archiveOnly?: boolean }): string;
export function readCandidate(input: string): { input: string; directory: string; release: CandidateRelease; archiveSha256?: string; members?: Record<string, Uint8Array> };
export function materializeCandidate(input: string): ReturnType<typeof readCandidate> & { cleanup(): void };
