import { z } from "zod";
export const entitlementsSchema = z.object({
	version: z.literal(1),
	subject: z.string(),
	plan: z.enum(["free", "plus", "pro"]),
	status: z.enum(["active", "expired", "cancelled"]),
	limits: z.object({
		storageBytes: z.number().nonnegative(),
		aiCreditsMonthly: z.number().nonnegative(),
		devices: z.number().nonnegative(),
	}),
	usage: z.object({
		storageBytes: z.number().nonnegative().nullable(),
		aiCreditsUsed: z.number().nonnegative().nullable(),
	}),
	expiresAt: z.string().nullable(),
	updatedAt: z.string(),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;
export const entitlementTokenPolicy = {
	algorithm: "RS256",
	audience: "keepany-sync",
	maxAgeSeconds: 60,
	scopes: ["sync:read", "sync:write"],
} as const;

// Sync bodies are opaque to the server. The client encrypts content before using this API.
// Metadata (workspace, entity key, version, size and timing) remains visible to the server.
export const syncKindSchema = z.enum([
	"asset",
	"relation",
	"task",
	"category",
	"submission",
	"history",
	"preference",
]);
const syncIdSchema = z
	.string()
	.min(1)
	.max(120)
	.regex(/^[a-zA-Z0-9:_-]+$/);
const ciphertextSchema = z.string().min(1).max(2_000_000);
export const syncOperationSchema = z
	.object({
		operationId: z.uuid(),
		id: syncIdSchema,
		kind: syncKindSchema,
		schemaVersion: z.number().int().min(1).max(100),
		expectedVersion: z.number().int().nonnegative(),
		ciphertext: ciphertextSchema,
		tombstone: z.boolean(),
		intent: z.enum(["write", "restore"]).default("write"),
	})
	.refine((value) => value.id.startsWith(`${value.kind}:`), {
		path: ["id"],
		message: "kind-mismatch",
	});
export type SyncOperation = z.infer<typeof syncOperationSchema>;
export const syncPushRequestSchema = z.object({
	workspaceId: z.uuid(),
	operations: z.array(syncOperationSchema).min(1).max(100),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export const syncPushResultSchema = z.object({
	operationId: z.uuid(),
	status: z.enum(["accepted", "duplicate", "conflict", "rejected"]),
	version: z.number().int().nonnegative(),
	sequence: z.number().int().nonnegative(),
	reason: z.enum(["version", "tombstone", "operation-reused"]).optional(),
});
export type SyncPushResult = z.infer<typeof syncPushResultSchema>;
export const syncPushResponseSchema = z.object({
	results: z.array(syncPushResultSchema),
});
export const syncPullRequestSchema = z.object({
	workspaceId: z.uuid(),
	cursor: z.number().int().nonnegative(),
	limit: z.number().int().min(1).max(500).default(100),
});
export type SyncPullRequest = z.infer<typeof syncPullRequestSchema>;
export const syncChangeSchema = z.object({
	operationId: z.uuid(),
	id: syncIdSchema,
	kind: syncKindSchema,
	schemaVersion: z.number().int().min(1).max(100),
	ciphertext: ciphertextSchema,
	tombstone: z.boolean(),
	version: z.number().int().positive(),
	sequence: z.number().int().positive(),
});
export type SyncChange = z.infer<typeof syncChangeSchema>;
export const syncPullResponseSchema = z.object({
	changes: z.array(syncChangeSchema),
	nextCursor: z.number().int().nonnegative(),
});
