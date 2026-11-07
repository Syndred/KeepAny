import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AccountCardMember } from "../account-card-groups";
import { mergeAccountCards, type AccountCardMergePlan } from "../account-card-merge";
import { recycleAccountCardBatch, type AccountCardBatchDeleteProgress, type AccountCardBatchDeleteTarget } from "../account-card-delete";
import { usePasswordVault } from "./PasswordVaultProvider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Select, SelectOption } from "./ui/select";

export type AccountBatchReview =
	| { kind: "delete"; members: readonly AccountCardMember[]; target: AccountCardBatchDeleteTarget }
	| { kind: "merge"; plan: AccountCardMergePlan }
	| { kind: "missing"; members: readonly AccountCardMember[] };

function memberLogin(member: AccountCardMember) {
	return member.entries[0]?.username || member.asset.username;
}

export function AccountBatchDialog({ review, onClose, onComplete, onAddMissing, returnFocusTo }: {
	review: AccountBatchReview;
	onClose: () => void;
	onComplete: (kind: "merge" | "delete") => void;
	onAddMissing: (members: readonly AccountCardMember[]) => void;
	returnFocusTo: () => HTMLElement | null;
}) {
	const { t } = useTranslation();
	const { session, snapshot } = usePasswordVault();
	const members = review.kind === "merge" ? review.plan.members : review.members;
	const [defaultId, setDefaultId] = useState(members[0]?.asset.id ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<"stale" | "error" | null>(null);
	const running = useRef(false);
	const progress = useRef<AccountCardBatchDeleteProgress>({});
	const defaultFieldId = useId();
	const count = members.length;

	async function apply() {
		if (review.kind === "missing" || !session || running.current || snapshot.status !== "unlocked") return;
		running.current = true;
		setBusy(true);
		setError(null);
		try {
			if (review.kind === "delete") await recycleAccountCardBatch(session, review.target, progress.current);
			else await mergeAccountCards(session, review.plan, defaultId);
			onComplete(review.kind);
		} catch (failure) {
			setError(failure instanceof Error && /stale|locked/.test(failure.message) ? "stale" : "error");
		} finally {
			running.current = false;
			setBusy(false);
		}
	}

	if (snapshot.status !== "unlocked") return null;
	const isDelete = review.kind === "delete";
	const isMerge = review.kind === "merge";
	const completed = progress.current.completed ?? 0;
	return <Dialog
		title={t(isDelete ? count === 1 ? "accountBatchDeleteTitleOne" : "accountBatchDeleteTitle" : isMerge ? "accountBatchMergeTitle" : "accountBatchMissingTitle", { count })}
		className="account-batch-dialog" closeDisabled={busy} focusTitleOnOpen
		returnFocusTo={returnFocusTo} onClose={() => { if (!running.current) onClose(); }}
	>
		<p>{t(isDelete ? "accountBatchDeleteHint" : isMerge ? "accountBatchMergeHint" : "accountBatchMissingHint", { count })}</p>
		{isMerge && <div className="account-batch-default">
			<label htmlFor={defaultFieldId}>{t("accountDefaultAction")}</label>
			<Select id={defaultFieldId} value={defaultId} onValueChange={setDefaultId} disabled={busy}>
				{members.map(member => <SelectOption key={member.asset.id} value={member.asset.id}>
					{[member.asset.name, memberLogin(member)].filter(Boolean).join(" · ")}
				</SelectOption>)}
			</Select>
		</div>}
		<ul className="account-batch-preview">
			{members.map(member => <li key={member.asset.id}>
				<div><strong>{member.asset.name}</strong>{memberLogin(member) && <small>{memberLogin(member)}</small>}</div>
				{isMerge && member.asset.id === defaultId && <Badge>{t("accountDefaultAction")}</Badge>}
			</li>)}
		</ul>
		{error && <div role="alert" className="field-error">
			{completed > 0 && <div>{t("accountBatchDeleteProgress", { completed, count })}</div>}
			{progress.current.partial && <div>{t("accountDeletePartial")}</div>}
			{t(error === "stale" ? "assetStale" : "error")}
		</div>}
		<div className="actions">
			<Button disabled={busy} onClick={onClose}>{t("cancel")}</Button>
			{review.kind === "missing"
				? <Button variant="primary" onClick={() => onAddMissing(members)}>{t("accountBatchSelectMissing")}</Button>
				: <Button variant={isDelete ? "danger" : "primary"} disabled={busy || error === "stale"} onClick={() => void apply()}>
					{t(busy ? "loading" : error ? "retry" : isDelete ? "accountBatchTrash" : "accountBatchConfirmMerge")}
				</Button>}
		</div>
	</Dialog>;
}
