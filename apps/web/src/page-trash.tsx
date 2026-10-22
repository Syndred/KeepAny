import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { restoreEntity } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Empty, PageTitle, date, useAppContext } from "./view-shared";
export function TrashPage() {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const assets = data.assets.filter((a) => a.deleted);
	const relations = data.relations.filter((relation) => relation.deleted);
	const [restoring, setRestoring] = useState("");
	const [errors, setErrors] = useState<Record<string, string>>({});
	const inFlight = useRef(false);
	async function restore(type: "asset" | "relation", id: string) {
		if (inFlight.current) return;
		inFlight.current = true;
		setRestoring(id);
		setErrors((current) => ({ ...current, [id]: "" }));
		try {
			await restoreEntity(type, id);
			notify(t("saved"));
		} catch (error) {
			const relation =
				type === "relation"
					? data.relations.find((item) => item.id === id)
					: null;
			const missingEndpoint =
				relation &&
				[relation.from, relation.to].some(
					(endpoint) => !data.assets.some((asset) => asset.id === endpoint),
				);
			setErrors((current) => ({
				...current,
				[id]:
					error instanceof Error && error.message === "relation-endpoint"
						? t(
								missingEndpoint
									? "relationEndpointMissing"
									: "relationRestoreBlocked",
							)
						: t("error"),
			}));
		} finally {
			inFlight.current = false;
			setRestoring("");
		}
	}
	return (
		<main className="page">
			<PageTitle title={t("trash")} />
			{assets.length > 0 && (
				<section className="card">
					<h2>{t("deletedAssets")}</h2>
					<div className="list">
						{assets.map((a) => (
							<div className="list-row" key={a.id}>
								<Trash2 size={18} />
								<div>
									<strong>{a.name}</strong>
									<small>{t(a.kind)}</small>
								</div>
								<Button
									size="small"
									disabled={!!restoring}
									onClick={() => void restore("asset", a.id)}
								>
									{t("restore")}
								</Button>
								{errors[a.id] && (
									<small className="field-error" role="alert">
										{errors[a.id]}
									</small>
								)}
							</div>
						))}
					</div>
				</section>
			)}
			{relations.length > 0 && (
				<section className="card">
					<h2>{t("deletedRelations")}</h2>
					<div className="list relation-list">
						{relations.map((relation) => {
							const from = data.assets.find(
								(asset) => asset.id === relation.from,
							);
							const to = data.assets.find((asset) => asset.id === relation.to);
							return (
								<div className="list-row relation-row" key={relation.id} data-relation-id={relation.id}>
									<Trash2 size={18} />
									<div className="relation-info">
										<strong>
											{from?.name ?? "—"} → {to?.name ?? "—"}
										</strong>
										<small>{relation.label}</small>
										{(relation.source || relation.verifiedAt) && (
											<small>
												{relation.source &&
													`${t("relationSource")}: ${relation.source}`}
												{relation.source && relation.verifiedAt && " · "}
												{relation.verifiedAt &&
													`${t("verifiedAt")}: ${date(relation.verifiedAt, i18n.language)}`}
											</small>
										)}
										{errors[relation.id] && (
											<small className="field-error" role="alert">
												{errors[relation.id]}
											</small>
										)}
									</div>
									<Button
										size="small"
										disabled={!!restoring}
										onClick={() => void restore("relation", relation.id)}
									>
										{t("restore")}
									</Button>
								</div>
							);
						})}
					</div>
				</section>
			)}
			{assets.length === 0 && relations.length === 0 && (
				<section className="card">
					<Empty hint={false} />
				</section>
			)}
		</main>
	);
}
