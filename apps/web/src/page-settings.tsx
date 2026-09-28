import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/button";
import { seed } from "./data";
import { PageTitle, useAppContext } from "./view-shared";
export function SettingsPage() {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const [persistent, setPersistent] = useState<boolean | null>(null);
	const [requested, setRequested] = useState(false);
	const [seeding, setSeeding] = useState(false);
	useEffect(() => {
		void navigator.storage?.persisted?.().then(setPersistent);
	}, []);
	return (
		<main className="page">
			<PageTitle title={t("settings")} />
			<div className="card-grid">
				<section className="card padded">
					<h2>{t("language")}</h2>
					<select
						value={i18n.language}
						onChange={(e) => {
							const value = e.target.value;
							localStorage.setItem("keepany-language", value);
							void i18n.changeLanguage(value);
						}}
					>
						<option value="zh-CN">简体中文</option>
						<option value="en">English</option>
					</select>
				</section>
				<section className="card padded">
					<h2>{t("storage")}</h2>
					<p>{t("storageHint")}</p>
					<div className="actions">
						<Button
							onClick={async () => {
								const value = await navigator.storage?.persist?.();
								setRequested(true);
								setPersistent(Boolean(value));
								notify(t(value ? "persistent" : "persistDenied"));
							}}
						>
							{t("persist")}
						</Button>
						<Link className="button" to="/intake">
							{t("backup")}
						</Link>
					</div>
					{(persistent === true || requested) && (
						<small>{t(persistent ? "persistent" : "persistDenied")}</small>
					)}
				</section>
			</div>
			<section className="card padded">
				<h2>{t("trial")}</h2>
				<p>{t("emptyHint")}</p>
				<Button
					disabled={data.assets.length > 0 || seeding}
					onClick={async () => {
						setSeeding(true);
						try {
							await seed();
							notify(t("saved"));
						} catch {
							notify(t("error"));
						} finally {
							setSeeding(false);
						}
					}}
				>
					{t("loadSample")}
				</Button>
			</section>
		</main>
	);
}
