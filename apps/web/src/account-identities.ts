export {
	emailIdentifier,
	phoneIdentifier,
} from "../../../packages/domain/src/account-identity";
import { normalizeLoginIdentifier } from "../../../packages/domain/src/account-identity";
import type { Asset, Relation } from "../../../packages/domain/src";

/** Only explicit login-identifier purposes publish an additional identifier. */
export function publishedLoginIdentifier(
	relation: Relation,
	assets: Asset[],
): string {
	if (relation.deleted || relation.purged) return "";
	const label = relation.label.trim().toLowerCase();
	const kind = ["登录邮箱", "login email"].includes(label)
		? "email"
		: ["登录手机号", "login phone"].includes(label)
			? "phone"
			: "";
	if (!kind) return "";
	const target = assets.find(
		(asset) => asset.id === relation.to && asset.kind === "account",
	);
	const identifier =
		normalizeLoginIdentifier(relation.source || "") ||
		normalizeLoginIdentifier(target?.username || target?.name || "");
	return identifier.startsWith(`${kind}:`) ? identifier : "";
}

/** These IDs are part of the existing intake format; keep the input order. */
export async function accountIdentityStableId(
	prefix: string,
	values: string[],
): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(JSON.stringify(values)),
		),
	);
	return `${prefix}-${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export const identityRelationLabels = [
	"登录邮箱",
	"登录手机号",
	"登录方式",
	"登录账号",
	"Login email",
	"Login phone",
	"Login provider",
	"Login account",
];
