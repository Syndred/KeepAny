import { assetSchema, historySchema, newAsset, normalizeCategoryName, type Asset, type AssetKind, type EntityType } from "../../../packages/domain/src";
import { localRepository, type LocalRepository } from "../../../packages/local-db/src";
import { COLLECTIONS_PREFERENCE_ID, readCollections } from "./collection-model";

export const SAMPLE_LIBRARY_ID = "sample-library-v2";
export const sampleImageNames = ["studio", "product", "logo", "cover", "laptop", "kit", "detail", "receipt"] as const;
type ImageIds = Record<typeof sampleImageNames[number], string>;
type Row = { type: EntityType; value: unknown };

/** Ordinary sample records contain no credentials. Dates stay relative to the day of installation. */
export function buildSampleLibrary(t: (key: string) => string, language: string, images: ImageIds, now = new Date()) {
	const createdAt = now.toISOString();
	const day = (offset: number) => {
		const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	};
	const currency = language.startsWith("zh") ? "CNY" as const : "USD" as const;
	const create = (kind: AssetKind, name: string, fields: Partial<Asset> = {}) => assetSchema.parse({
		...newAsset(kind), name: `${t("samplePrefix")} | ${t(name)}`, currency, createdAt, updatedAt: createdAt,
		...fields,
	});
	const work = t("sampleWorkTag");
	const studio = create("project", "sampleStudio", { category: "website", url: "https://pinecone.example.com", description: t("sampleStudioDescription"), projectEmail: "hello@example.com", projectLaunchMonth: day(-120).slice(0, 7), projectInspectionDate: day(-2), tags: [work],
		attachments: [images.studio, images.logo, images.cover], projectMedia: { homeScreenshotId: images.studio, logoId: images.logo, promoCoverId: images.cover, productScreenshotIds: [] } });
	const notes = create("project", "sampleProject", { category: "website", url: "https://notes.example.com", description: t("sampleProjectDescription"), longDescription: t("sampleLongDescription"), tags: [work, t("sampleWritingTag")], attachments: [images.product], projectMedia: { homeScreenshotId: images.product, logoId: "", promoCoverId: "", productScreenshotIds: [] } });
	const components = create("project", "sampleComponents", { category: "repository", description: t("sampleComponentsDescription"), tags: [work], url: "https://code.example.com/paperplane" });
	const minimal = create("project", "sampleMinimal");
	const accounts = [
		create("account", "sampleAccount", { category: "email", username: "hello@example.com", accountProvider: "Example Mail", accountProfileVerifiedAt: day(-2), tags: [work] }),
		create("account", "sampleCodeAccount", { category: "other", username: "pinecone-dev", url: "https://code.example.com", tags: [work] }),
		create("account", "samplePhoneAccount", { category: "phone", username: "+1 202-555-0142", tags: [work] }),
		create("account", "sampleDesignAccount", { category: "other", username: "design@example.com", url: "https://design.example.com", tags: [work] }),
		create("account", "sampleAnalyticsAccount", { category: "other", username: "hello@example.com" }),
		create("account", "sampleContentAccount", { category: "other", username: "pinecone", description: t("sampleStudioDescription") }),
		create("account", "sampleDocsAccount", { category: "other", username: "docs@example.com" }),
		create("account", "sampleNoPasswordAccount", { category: "other", url: "https://login.example.com" }),
	];
	studio.projectDomains = [{ id: crypto.randomUUID(), name: "pinecone.example.com", registrar: "Example Registrar", accountId: accounts[1].id, expiryDate: day(10), annualAmount: 8800, currency, autoRenew: "unknown" }];
	notes.projectDomains = [{ id: crypto.randomUUID(), name: "notes.example.com", registrar: "Example Registrar", accountId: accounts[0].id, expiryDate: day(60), annualAmount: 12000, currency, autoRenew: "off" }];
	const subscriptions = [
		create("subscription", "sampleHosting", { category: "service", amount: 8800, dueDate: day(6), billingAnchor: day(6), tags: [work], subscriptionPaymentMethod: "Visa · 0000" }),
		create("subscription", "sampleDesignSubscription", { category: "software", amount: 3900, dueDate: day(15), tags: [work], discountAmount: 900, discountUntil: day(30) }),
		create("subscription", "sampleDocsSubscription", { category: "software", cycle: "year", amount: 29900, dueDate: day(90) }),
		create("subscription", "sampleTrialSubscription", { category: "service", amount: 1900, dueDate: day(7), trialEndsAt: day(7) }),
		create("subscription", "samplePausedSubscription", { category: "service", amount: 5900, dueDate: day(20), status: "paused" }),
		create("subscription", "sampleCancelledSubscription", { category: "service", amount: 500, cycle: "week", dueDate: day(-1), status: "cancelled", cancelledAt: day(-7) }),
	];
	const items = [
		create("item", "sampleLaptop", { category: "device", description: t("sampleDeviceDescription"), amount: 899900, itemPurchasePriceKnown: true, purchaseDate: day(-180), warrantyDate: day(185), itemWarrantyStatus: "inWarranty", location: t("sampleLocation"), tags: [work], attachments: [images.laptop, images.detail, images.receipt], itemMedia: { coverId: images.laptop, detailIds: [images.detail], receiptIds: [images.receipt] } }),
		create("item", "sampleBackpack", { category: "device", description: t("sampleLoanNote"), status: "loaned", borrower: t("sampleBorrower"), itemExpectedReturnDate: day(7), attachments: [images.kit], itemMedia: { coverId: images.kit, detailIds: [], receiptIds: [] }, tags: [work] }),
		create("item", "sampleTablet", { category: "device", itemLifecycleStatus: "repairing", description: t("sampleRepairNote"), warrantyDate: day(-60), itemWarrantyStatus: "outOfWarranty" }),
		create("item", "sampleAdapter", { category: "other", itemWarrantyStatus: "notApplicable" }),
		create("item", "sampleDisplay", { category: "device", itemLifecycleStatus: "resold", status: "archived", purchaseDate: day(-700), itemStatusDate: day(-30) }),
		create("item", "sampleCamera", { category: "device", description: t("sampleLongDescription"), purchaseDate: day(-400), itemWarrantyStatus: "outOfWarranty", location: t("sampleLocation"), tags: [work, t("samplePersonalTag")] }),
	];
	const vaults = [create("vault", "sampleVault", { category: "other", location: t("sampleVaultLocation") }), create("vault", "sampleOfflineVault", { category: "other", location: "KDBX" })];
	const assets = [studio, notes, components, minimal, ...accounts, ...subscriptions, ...items, ...vaults];
	const relation = (from: Asset, to: Asset, label: string, verified = true) => ({ id: crypto.randomUUID(), from: from.id, to: to.id, label: t(label), source: t("samplePrefix"), verifiedAt: verified ? day(-2) : "", createdAt });
	const relations = [
		relation(studio, notes, "sampleProjectRelation"), relation(studio, components, "sampleProjectRelation"), relation(studio, accounts[0], "sampleContactRelation"),
		...accounts.slice(1).map((account, index) => relation(account, accounts[index === 1 ? 0 : 2], index === 1 ? "sampleLoginRelation" : "samplePhoneRelation", index % 2 === 0)),
		...subscriptions.map((subscription, index) => relation(subscription, index % 2 ? notes : studio, "sampleSubscriptionRelation")),
		...subscriptions.slice(0, 4).map((subscription, index) => relation(subscription, accounts[index], "sampleLoginRelation")),
		relation(items[0], studio, "sampleDeviceRelation"), relation(items[1], notes, "sampleDeviceRelation"), relation(vaults[0], accounts[0], "sampleVaultRelation"),
	];
	const tasks = [
		{ name: t("sampleReviewTask"), assetId: studio.id, dueDate: day(1) },
		{ name: t("sampleMaintenanceTask"), assetId: items[0].id, dueDate: day(3) },
		{ name: t("sampleDomainTask"), assetId: studio.id, dueDate: day(7) },
		{ name: t("sampleCompletedTask"), assetId: components.id, dueDate: day(-2), done: true, completedAt: createdAt, completionHistory: [createdAt] },
		{ name: t("sampleOverdueTask"), assetId: notes.id, dueDate: day(-1) },
	].map((task) => ({ id: crypto.randomUUID(), createdAt, ...task }));
	const history = [
		{ assetId: items[0].id, action: "maintenance", eventDate: day(-1), note: t("sampleMaintenanceNote") },
		{ assetId: items[0].id, action: "loan", borrower: t("sampleBorrower"), eventDate: day(-10), expectedReturnDate: day(-8), note: t("sampleLoanNote") },
		{ assetId: items[0].id, action: "return", borrower: t("sampleBorrower"), eventDate: day(-8), note: t("sampleReturnNote") },
		{ assetId: items[1].id, action: "loan", borrower: t("sampleBorrower"), eventDate: day(-1), expectedReturnDate: day(7), note: t("sampleLoanNote") },
		{ assetId: subscriptions[0].id, assetIds: [subscriptions[0].id, studio.id], action: "expense", title: t("sampleBill"), amount: 8800, currency, eventDate: day(-30), note: "" },
		{ assetId: subscriptions[1].id, action: "renew", amount: 3000, currency, eventDate: day(-15), billDate: day(-15), note: "" },
		{ assetId: subscriptions[0].id, action: "topup", title: t("sampleTopup"), amount: 20000, currency, eventDate: day(-20), note: "" },
		{ assetId: subscriptions[0].id, action: "refund", title: t("sampleRefund"), amount: 1000, currency, eventDate: day(-19), note: "" },
		{ assetId: subscriptions[0].id, action: "balance", title: t("sampleBalance"), amount: 12200, currency, eventDate: day(-18), note: "" },
	].map((entry) => ({ id: crypto.randomUUID(), source: t("samplePrefix"), createdAt, ...entry }));
	const rows: Row[] = [...assets.map((value) => ({ type: "asset" as const, value })), ...relations.map((value) => ({ type: "relation" as const, value })), ...tasks.map((value) => ({ type: "task" as const, value })), ...history.map((value) => ({ type: "history" as const, value }))];
	return { rows, assets };
}

type SampleInstall = { version: number; phase: "base" | "complete"; assetIds: string[]; targets?: Asset[] };
export function sampleLibraryAssetIds(value: unknown): string[] {
	if (!value || typeof value !== "object" || !Array.isArray((value as { assetIds?: unknown }).assetIds)) return [];
	return (value as { assetIds: unknown[] }).assetIds.filter((id): id is string => typeof id === "string" && !!id && id.length <= 96);
}
export function sampleLibraryComplete(value: unknown): boolean {
	return !!value && typeof value === "object" && (value as { phase?: string }).phase === "complete" && sampleLibraryAssetIds(value).length > 0;
}

export async function addSampleLibrary(t: (key: string) => string, language: string, injectedRepository?: LocalRepository) {
	const run = async () => {
		const repository = injectedRepository ?? await localRepository();
		let marker = await repository.get<{ id: string; value: SampleInstall }>("preference", SAMPLE_LIBRARY_ID);
		if (sampleLibraryComplete(marker?.value)) return false;
		if (marker && (marker.value?.phase !== "base" || sampleLibraryAssetIds(marker.value).length !== 26 || !Array.isArray(marker.value.targets))) throw Error("sample-marker-invalid");
		const uploaded: string[] = [];
		try {
			if (!marker) {
				const images = {} as ImageIds;
				for (const name of sampleImageNames) {
					const response = await fetch(`${import.meta.env.BASE_URL}samples/${name}.png`);
					if (!response.ok) throw Error("sample-image-missing");
					const blob = await response.blob();
					if (blob.type !== "image/png") throw Error("sample-image-invalid");
					const id = await repository.putFile(new File([blob], `${t("samplePhotoName")}-${name}.png`, { type: "image/png" }));
					uploaded.push(id); images[name] = id;
				}
				const library = buildSampleLibrary(t, language, images);
				const targets = library.assets.filter((asset) => asset.kind === "item" && (asset.status !== "active" || asset.itemLifecycleStatus !== "inUse"));
				const rows = library.rows.filter((row) => !(row.type === "history" && (row.value as { assetId: string }).assetId === targets.find((asset) => asset.status === "loaned")?.id));
				for (const row of rows) if (row.type === "asset" && (row.value as Asset).kind === "item") {
					row.value = { ...row.value as Asset, status: "active", borrower: "", itemExpectedReturnDate: "", itemLifecycleStatus: "inUse", itemStatusDate: "" };
				}
				marker = { id: SAMPLE_LIBRARY_ID, value: { version: 2, phase: "base", assetIds: library.assets.map((asset) => asset.id), targets } };
				rows.push({ type: "preference", value: marker });
				await repository.saveBatch(rows);
			}
			// Complete state changes through the same atomic asset/history transitions as the UI.
			// The durable base marker makes retries resume these sample IDs instead of adding another set.
			for (const input of marker.value.targets ?? []) {
				const target = assetSchema.parse(input);
				if (target.kind !== "item" || !marker.value.assetIds.includes(target.id)) throw Error("sample-marker-invalid");
				let current = await repository.get<Asset>("asset", target.id);
				if (!current || current.deleted) continue;
				const eventDate = target.itemStatusDate || target.createdAt.slice(0, 10);
				if (target.itemLifecycleStatus !== "inUse" && current.itemLifecycleStatus === "inUse") {
					const id = crypto.randomUUID();
					await repository.recordItemAction(current, { ...current, itemLifecycleStatus: target.itemLifecycleStatus, itemStatusDate: eventDate, lastItemEventId: id }, historySchema.parse({ id, assetId: current.id, action: "itemStatus", itemStatusBefore: current.itemLifecycleStatus, itemStatusAfter: target.itemLifecycleStatus, eventDate, note: target.description, createdAt: target.createdAt }));
					current = await repository.get<Asset>("asset", target.id);
				}
				if (current && target.status === "loaned" && current.status === "active") {
					const id = crypto.randomUUID();
					await repository.recordItemAction(current, { ...current, status: "loaned", borrower: target.borrower, itemExpectedReturnDate: target.itemExpectedReturnDate, lastItemEventId: id }, historySchema.parse({ id, assetId: current.id, action: "loan", borrower: target.borrower, expectedReturnDate: target.itemExpectedReturnDate, eventDate, note: target.description, createdAt: target.createdAt }));
				} else if (current && target.status === "archived" && current.status === "active") await repository.setItemArchived(current.id, "active");
			}
			const assetIds = marker.value.assetIds;
			for (let attempt = 0; attempt < 3; attempt++) {
				const saved = await repository.get<{ id: string; value: unknown }>("preference", COLLECTIONS_PREFERENCE_ID);
				const collections = readCollections(saved?.value), name = t("sampleCollection");
				const existing = collections.find((collection) => normalizeCategoryName(collection.name) === normalizeCategoryName(name));
				if (!existing && collections.length >= 8) break;
				const value = existing ? collections.map((collection) => collection.id === existing.id ? { ...collection, assetIds: [...new Set([...collection.assetIds, ...assetIds])] } : collection)
					: [...collections, { id: crypto.randomUUID(), name, assetIds }];
				try { await repository.savePreferenceIfCurrent(saved, { id: COLLECTIONS_PREFERENCE_ID, value }); break; }
				catch (error) { if (!(error instanceof Error) || error.message !== "preference-stale" || attempt === 2) throw error; }
			}
			await repository.savePreferenceIfCurrent(marker, { id: SAMPLE_LIBRARY_ID, value: { version: 2, phase: "complete", assetIds: marker.value.assetIds } });
			return true;
		} catch (error) {
			await Promise.allSettled(uploaded.map((id) => repository.cleanupUnreferencedFile(id)));
			throw error;
		}
	};
	return globalThis.navigator?.locks ? navigator.locks.request(SAMPLE_LIBRARY_ID, run) : run();
}
