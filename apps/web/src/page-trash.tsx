import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { restoreEntity } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Empty, PageTitle, useAppContext } from "./view-shared";
export function TrashPage() {
	const { data, notify } = useAppContext();
	const { t } = useTranslation();
	const assets = data.assets.filter((a) => a.deleted);
	return (
		<main className="page">
			<PageTitle title={t("trash")} />
			<section className="card">
				{assets.length ? (
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
									onClick={async () => {
										await restoreEntity("asset", a.id);
										notify(t("saved"));
									}}
								>
									{t("restore")}
								</Button>
							</div>
						))}
					</div>
				) : (
					<Empty hint={false} />
				)}
			</section>
		</main>
	);
}
