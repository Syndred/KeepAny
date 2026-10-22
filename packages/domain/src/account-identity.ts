import { z } from "zod";
import type { Asset } from "./index";

/** Numeric usernames alone are not phone numbers. */
export function emailIdentifier(value: string): string {
	const trimmed = value.trim();
	return z.email().safeParse(trimmed).success ? trimmed.toLowerCase() : "";
}

export function phoneIdentifier(value: string): string {
	const trimmed = value.trim();
	if (!/^[+\d() -]+$/.test(trimmed)) return "";
	const digits = trimmed.replace(/[() -]/g, "");
	if (/^1[3-9]\d{9}$/.test(digits)) return digits;
	if (/^\+861[3-9]\d{9}$/.test(digits)) return digits.slice(3);
	return /^\+[1-9]\d{6,14}$/.test(digits) ? digits : "";
}

export function normalizeLoginIdentifier(value: string): string {
	const text = value.trim().normalize("NFKC");
	const email = emailIdentifier(text),
		phone = phoneIdentifier(text);
	if (email) return `email:${email}`;
	if (phone) return `phone:${phone}`;
	// Handles are platform-specific and cannot connect unrelated services.
	return "";
}

/** Prevent restoring a second account after the same login has been re-imported. */
export function conflictsWithAccountRestore(
	a: Pick<Asset, "kind" | "name" | "username" | "category">,
	b: Pick<Asset, "kind" | "name" | "username" | "category">,
): boolean {
	if (a.kind !== "account" || b.kind !== "account" || !a.username.trim())
		return false;
	const identifier = normalizeLoginIdentifier(a.username);
	if (
		(identifier || a.username.trim()) !==
		(normalizeLoginIdentifier(b.username) || b.username.trim())
	)
		return false;
	if (
		identifier &&
		a.category === b.category &&
		a.category === identifier.split(":")[0]
	)
		return true;
	return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}
