export {
	emailIdentifier,
	phoneIdentifier,
} from "../../../packages/domain/src/account-identity";

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
