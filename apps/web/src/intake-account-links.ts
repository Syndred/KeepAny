import { assetSchema, newAsset, relationSchema, type Asset, type Relation } from "../../../packages/domain/src";
import { localRepository, type LocalRepository } from "../../../packages/local-db/src";
import { getReviewedCandidate, type ReviewedCandidate } from "../../../packages/local-db/src/intake-review";
import { accountIdentityStableId as stableId, emailIdentifier, phoneIdentifier, identityRelationLabels } from "./account-identities";
import { saveAccountWithIdentityLinks } from "./account-identity-save";

export type AccountIdentityKind = "email" | "phone" | "provider";
export interface AccountIdentityPreview {
	kind: AccountIdentityKind;
	identifier: string;
	provider: string;
	unknownUsername: boolean;
}
export interface AccountLinkLabels { email: string; phone: string; provider: string }
export interface ReviewedAccountLink {
	candidateId: string;
	identity: AccountIdentityPreview;
	target: Asset;
	relation: Relation | null;
	status: "created" | "existing";
}
export interface ReviewedAccountLinksResult {
	createdAssets: number;
	createdRelations: number;
	existingRelations: number;
	links: ReviewedAccountLink[];
	unresolved: Array<{ candidateId: string; kind: AccountIdentityKind; reason: "unknown-username" | "ambiguous-target" | "deleted-target" | "deleted-relation" | "changed-target" }>;
	previews: Array<{ candidateId: string; identities: AccountIdentityPreview[] }>;
}

function githubAccount(asset: Asset): boolean {
	if (asset.kind !== "account") return false;
	if (asset.accountProvider.trim().toLowerCase() === "github") return true;
	try { return new URL(asset.url).hostname.toLowerCase() === "github.com"; }
	catch { return asset.category === "social" && asset.name.trim().toLowerCase() === "github"; }
}
function explicitGithubLogin(value: string): boolean {
	return /[（(]\s*github\s*[）)]|\bgithub\s*(?:登录|登入|登陆|sign[ -]?in|login)|(?:通过|使用|用)\s*github\s*(?:登录|登入|登陆)|(?:login|sign[ -]?in)\s+(?:with|via|using)\s+github\b/iu.test(value);
}

/** Only use the reviewed identifier and this record's evidence, never the whole batch. */
export function previewAccountIdentity(asset: Asset, row?: Pick<ReviewedCandidate, "ai">): AccountIdentityPreview[] {
	if (asset.kind !== "account" || asset.deleted) return [];
	const identifier = asset.username.trim();
	const email = emailIdentifier(identifier), phone = phoneIdentifier(identifier);
	const identities: AccountIdentityPreview[] = email
		? [{ kind: "email", identifier: email, provider: email.slice(email.lastIndexOf("@") + 1), unknownUsername: false }]
		: phone ? [{ kind: "phone", identifier: phone, provider: "", unknownUsername: false }] : [];
	if (githubAccount(asset) || explicitGithubLogin(asset.description) || explicitGithubLogin(row?.ai?.evidence ?? "")) {
		// An email/phone used to access another site does not identify a GitHub user.
		const githubUsername = identifier && !email && !phone ? identifier : "";
		identities.push({ kind: "provider", identifier: githubUsername, provider: "GitHub", unknownUsername: !githubUsername });
	}
	return identities;
}

function identityIdentifier(asset: Asset, identity: AccountIdentityPreview): string {
	const value = asset.username.trim() || asset.name.trim();
	return identity.kind === "email" ? emailIdentifier(value)
		: identity.kind === "phone" ? phoneIdentifier(value) : asset.username.trim().toLowerCase();
}
function matchesIdentity(asset: Asset, identity: AccountIdentityPreview): boolean {
	if (asset.kind !== "account") return false;
	const correctKind = identity.kind === "provider" ? githubAccount(asset) : asset.category === identity.kind;
	if (!correctKind) return false;
	const identifier = identityIdentifier(asset, identity);
	return identity.unknownUsername ? Boolean(identifier) : identifier === identity.identifier.toLowerCase();
}
const accountLinkLocks = new Map<string, Promise<void>>();
async function withAccountLinkLock<T>(repository: LocalRepository, action: () => Promise<T>): Promise<T> {
	const name = `keepany-intake-account-links:${repository.records.name}`;
	const previous = accountLinkLocks.get(name) ?? Promise.resolve();
	const run = previous.then(() => {
		const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
		return locks ? locks.request(name, action) : action();
	});
	const tail = run.then(() => {}, () => {});
	accountLinkLocks.set(name, tail);
	try { return await run; }
	finally { if (accountLinkLocks.get(name) === tail) accountLinkLocks.delete(name); }
}

/** Add identity nodes/edges for saved, accepted accounts; never alter existing records. */
export async function ensureReviewedAccountLinks(input: ReviewedCandidate[], options: {
	labels: AccountLinkLabels; repository?: LocalRepository;
}): Promise<ReviewedAccountLinksResult> {
	const repository = options.repository ?? await localRepository();
	return withAccountLinkLock(repository, async () => {
		const result: ReviewedAccountLinksResult = { createdAssets: 0, createdRelations: 0, existingRelations: 0, links: [], unresolved: [], previews: [] };
		for (const candidateId of new Set(input.map((row) => row.id))) {
			const row = await getReviewedCandidate(repository.fileStore, candidateId);
			if (row?.status !== "accepted" || row.reviewMode === "expense") continue;
			const source = await repository.get<Asset>("asset", row.asset.id);
			if (!source || source.deleted || source.kind !== "account") continue;
			const identities = previewAccountIdentity(source, row);
			result.previews.push({ candidateId, identities });
			for (const identity of identities) {
				const unresolved = (reason: ReviewedAccountLinksResult["unresolved"][number]["reason"]) => result.unresolved.push({ candidateId, kind: identity.kind, reason });
				const assets = await repository.list<Asset>("asset", true);
				const matches = assets.filter((asset) => matchesIdentity(asset, identity));
				const live = matches.filter((asset) => !asset.deleted);
				if (live.length > 1) { unresolved("ambiguous-target"); continue; }
				const targetId = identity.unknownUsername ? "" : await stableId("login-identity", [identity.kind, identity.provider.toLowerCase(), identity.identifier.toLowerCase()]);
				const stableTarget = assets.find((asset) => asset.id === targetId);
				let target = live[0];
				if (!target && stableTarget) {
					if (stableTarget.deleted) { unresolved("deleted-target"); continue; }
					if (stableTarget.kind !== "account" || (identity.kind === "provider" && !githubAccount(stableTarget)) ||
						identityIdentifier(stableTarget, identity) !== identity.identifier.toLowerCase()) { unresolved("changed-target"); continue; }
					// A user may have renamed the category of a node we already created.
					target = stableTarget;
				}
				if (!target && matches.some((asset) => asset.deleted)) { unresolved("deleted-target"); continue; }
				if (!target && identity.unknownUsername) { unresolved("unknown-username"); continue; }
				if (target?.id === source.id) {
					result.links.push({ candidateId, identity, target, relation: null, status: "existing" });
					continue;
				}
				const newTarget = !target;
				if (!target) target = assetSchema.parse({ ...newAsset("account"), id: targetId,
					name: identity.kind === "provider" ? `GitHub · ${identity.identifier}`.slice(0, 160) : identity.identifier.slice(0, 160),
					category: identity.kind === "provider" ? "social" : identity.kind,
					username: identity.identifier, accountProvider: identity.provider });
				const relationId = await stableId("login-link", [source.id, identity.kind, target.id]);
				const relations = await repository.list<Relation>("relation", true);
				const label = options.labels[identity.kind];
				const same = relations.find((relation) => relation.id === relationId);
				if (same && (same.from !== source.id || same.to !== target.id)) { unresolved("changed-target"); continue; }
				const equivalent = relations.filter((relation) => relation.from === source.id && relation.to === target.id &&
					[...identityRelationLabels, label].some((item) => item.toLowerCase() === relation.label.trim().toLowerCase()));
				const existing = (same && !same.deleted ? same : undefined) ?? equivalent.find((relation) => !relation.deleted);
				if (existing) {
					result.existingRelations++;
					result.links.push({ candidateId, identity, target, relation: existing, status: "existing" });
					continue;
				}
				if (same?.deleted || equivalent.some((relation) => relation.deleted)) { unresolved("deleted-relation"); continue; }
				const timestamp = new Date().toISOString();
				const relation = relationSchema.parse({ id: relationId, from: source.id, to: target.id, label,
					source: row.fileName.slice(0, 500), createdAt: timestamp, verifiedAt: "", deleted: false });
				// The existing import journal atomically rolls back this node/edge pair.
				await repository.saveBatchIfAssetsCurrent([...(newTarget ? [{ type: "asset" as const, value: target }] : []), { type: "relation", value: relation }], [source, ...(!newTarget ? [target] : [])]);
				result.createdAssets += newTarget ? 1 : 0;
				result.createdRelations++;
				result.links.push({ candidateId, identity, target, relation, status: "created" });
			}
		}
		const identities = new Map(result.links.filter(link => link.identity.kind !== "provider").map(link => [link.target.id, link.target]));
		for (const target of identities.values()) {
			const before = new Set((await repository.list<Relation>("relation", true)).map(line => line.id));
			await saveAccountWithIdentityLinks(target, target, (_kind, identityKind) => options.labels[identityKind ?? "email"], repository);
			result.createdRelations += (await repository.list<Relation>("relation")).filter(line => !before.has(line.id)).length;
		}
		return result;
	});
}
