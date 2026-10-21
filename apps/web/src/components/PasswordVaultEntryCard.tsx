import { Link } from "@tanstack/react-router";
import {
	ArrowUpRight,
	Copy,
	Eye,
	EyeOff,
	History,
	KeyRound,
	Link2,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";
import {
	type ButtonHTMLAttributes,
	type ReactNode,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import type {
	PasswordVaultEntrySummary,
	PasswordVaultSession,
} from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { TaskCard } from "./ui/task-card";
import { TextLink } from "./ui/text-link";

export function VaultIconButton({
	label,
	className = "",
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
	return (
		<Button
			type="button"
			size="icon"
			variant="ghost"
			className={`password-vault-icon ${className}`}
			aria-label={label}
			title={label}
			{...props}
		/>
	);
}

export function PasswordVaultEntryCard({
	entry,
	session,
	assetsById,
	busy,
	onEdit,
	onAddAnother,
	onDelete,
	onHistory,
	onCopy,
}: {
	entry: PasswordVaultEntrySummary;
	session: PasswordVaultSession;
	assetsById: Map<string, Asset>;
	busy: boolean;
	onEdit: () => void;
	onAddAnother: () => void;
	onDelete: () => void;
	onHistory: () => void;
	onCopy: (label: string, value: string) => void;
}) {
	const { t, i18n } = useTranslation();
	const [revealed, setRevealed] = useState(false);
	// Keep protected fields out of the shared summary, search index and persistence.
	// Only this unlocked vault view reads notes; passwords are read again on demand.
	const { notes, hasPassword } = useMemo(() => {
		const value = session.readEntry(entry.id);
		return { notes: value.notes, hasPassword: Boolean(value.password) };
	}, [session, entry]);
	const date = new Intl.DateTimeFormat(i18n.language, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(entry.modifiedAt));
	const copy = (
		key: string,
		value: string,
		label = t("pwSmartCopyField", { field: t(key) }),
	) => (
		<VaultIconButton
			label={label}
			disabled={busy || !value}
			onClick={() => onCopy(key, value)}
		>
			<Copy size={16} />
		</VaultIconButton>
	);
	const row = (
		label: string,
		value: ReactNode,
		actions: ReactNode,
		className = "",
	) => (
		<dl className={`password-vault-value-row ${className}`}>
			<dt>{label}</dt>
			<dd className="password-vault-value">
				{value || (
					<span className="password-vault-muted">{t("pwVaultValueEmpty")}</span>
				)}
			</dd>
			<dd className="password-vault-value-actions">{actions}</dd>
		</dl>
	);
	return (
		<TaskCard
			className="password-vault-entry"
			tabIndex={-1}
			data-entry-id={entry.id}
		>
			<header className="password-vault-entry-heading">
				<span className="password-vault-entry-avatar" aria-hidden="true">
					<KeyRound size={22} />
				</span>
				<div className="password-vault-entry-heading-copy">
					<h2 className="password-vault-entry-title">{entry.title}</h2>
					<small>{t("pwVaultCreatedAt", { date })}</small>
				</div>
			</header>
			<div className="password-vault-values">
				{row(
					t("pwVaultAccountShort"),
					entry.username,
					copy(
						"pwVaultUsernameField",
						entry.username,
						t("pwVaultCopyUsername"),
					),
				)}
				{row(
					t("pwVaultPasswordField"),
					hasPassword ? (
						<span className="password-vault-secret">
							{revealed ? session.readEntry(entry.id).password : "••••••••••••"}
						</span>
					) : (
						t("pwVaultNoPassword")
					),
					<>
						<VaultIconButton
							label={t(
								revealed ? "pwVaultHidePasswordValue" : "pwVaultRevealPassword",
							)}
							aria-pressed={revealed}
							disabled={busy || !hasPassword}
							onClick={() => setRevealed(!revealed)}
						>
							{revealed ? <EyeOff size={16} /> : <Eye size={16} />}
						</VaultIconButton>
						<VaultIconButton
							label={t("pwVaultCopyPassword")}
							disabled={busy || !hasPassword}
							onClick={() =>
								onCopy(
									"pwVaultPasswordField",
									session.readEntry(entry.id).password,
								)
							}
						>
							<Copy size={16} />
						</VaultIconButton>
					</>,
					"password-vault-password-row",
				)}
				{!!entry.usernameAliases?.length && (
					<div className="password-vault-identifiers">
						{entry.usernameAliases.map((value, index) => (
							<dl
								className="password-vault-value-row password-vault-identifier-row"
								key={value}
								data-identifier-index={index + 2}
							>
								<dt>
									{index === 0 ? (
										t("pwVaultIdentifiersShort")
									) : (
										<span className="password-vault-sr">
											{t("pwVaultIdentifiersShort")}
										</span>
									)}
								</dt>
								<dd className="password-vault-value">{value}</dd>
								<dd className="password-vault-value-actions">
									{copy(
										"pwVaultUsernameField",
										value,
										t("pwVaultCopyIdentifier", { count: index + 2 }),
									)}
								</dd>
							</dl>
						))}
					</div>
				)}
				{entry.url &&
					row(
						t("pwVaultUrlField"),
						<TextLink href={entry.url} target="_blank" rel="noreferrer">
							<span>{entry.url}</span>
							<ArrowUpRight size={14} aria-hidden="true" />
						</TextLink>,
						copy("pwVaultUrlField", entry.url),
					)}
				{row(
					t("pwVaultNotesField"),
					notes,
					copy("pwVaultNotesField", notes),
					"password-vault-notes-row",
				)}
			</div>
			{entry.linkedAssetIds.length > 0 && (
				<div className="password-vault-linked-assets">
					<Link2 size={14} aria-label={t("pwVaultLinkedAssets")} />
					{entry.linkedAssetIds.map((id) =>
						assetsById.has(id) ? (
							<Link
								className="password-vault-linked-asset"
								key={id}
								to="/assets/$kind/$id"
								params={{ kind: assetsById.get(id)?.kind ?? "account", id }}
								hash="account-relations"
								title={t("pwConnectGraph")}
							>
								<Link2 size={14} />
								{assetsById.get(id)?.name}
							</Link>
						) : (
							<span key={id}>{t("pwVaultAssetUnavailable")}</span>
						),
					)}
				</div>
			)}
			<footer className="actions password-vault-entry-actions">
				<VaultIconButton
					label={t("pwVaultAddAnotherAccount")}
					disabled={busy}
					onClick={onAddAnother}
				>
					<Plus size={18} />
				</VaultIconButton>
				<VaultIconButton
					label={t("pwVaultEditEntry")}
					disabled={busy}
					onClick={onEdit}
				>
					<Pencil size={18} />
				</VaultIconButton>
				<VaultIconButton
					label={t("pwVaultHistory")}
					disabled={busy}
					onClick={onHistory}
				>
					<History size={18} />
				</VaultIconButton>
				<VaultIconButton
					label={t("pwVaultDeleteEntry")}
					className="password-vault-delete"
					disabled={busy}
					onClick={onDelete}
				>
					<Trash2 size={18} />
				</VaultIconButton>
			</footer>
		</TaskCard>
	);
}
