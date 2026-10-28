/** Synthetic records only. Used by browser acceptance and the gstack owned fixture. */
export async function seedDensityBrowser({
	repositoryPath,
	domainPath,
	language,
}: {
	repositoryPath: string;
	domainPath: string;
	language: "zh-CN" | "en";
}) {
	const { saveBatch, putFile, localRepository } = await import(repositoryPath);
	const { newAsset, taskSchema, historySchema, relationSchema } = await import(
		domainPath
	);
	const zh = language === "zh-CN";
	const existing = await (await localRepository()).list("asset");
	if (existing.length)
		throw Error("Density fixture requires an empty owned origin");
	localStorage.setItem("keepany-language", language);
	const canvas = document.createElement("canvas");
	canvas.width = 640;
	canvas.height = 320;
	const context = canvas.getContext("2d")!;
	context.fillStyle = "#dce9fa";
	context.fillRect(0, 0, 640, 320);
	context.fillStyle = "#20304a";
	context.fillRect(170, 45, 300, 190);
	context.fillStyle = "#fff5df";
	context.fillRect(180, 55, 280, 170);
	context.fillStyle = "#ffd24c";
	context.fillRect(205, 80, 230, 22);
	context.fillStyle = "#a9dfca";
	context.fillRect(205, 120, 100, 75);
	context.fillStyle = "#dfd3ef";
	context.fillRect(320, 120, 115, 75);
	context.fillStyle = "#20304a";
	context.fillRect(145, 235, 350, 15);
	const blob = await new Promise<Blob>((resolve) =>
		canvas.toBlob((blob) => resolve(blob!), "image/png"),
	);
	const imageId = await putFile(
		new File([blob], "synthetic-workstation.png", { type: "image/png" }),
	);
	const richProject = {
		...newAsset("project"),
		name: zh ? "松果创作工作室" : "Pinecone creative studio",
		category: "repository",
		url: "https://studio.example.test",
		description: zh
			? "品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。"
			: "Brand, website and content archive with domains, subscriptions and delivery tasks.",
		tags: [zh ? "创作" : "Creative", "TypeScript"],
		projectDomains: [
			{
				id: crypto.randomUUID(),
				name: "studio.example.test",
				expiryDate: "2026-12-15",
				annualAmount: 12000,
				currency: "CNY",
				registrar: "Synthetic registrar",
				autoRenew: "on",
			},
		],
	};
	const simpleProject = {
		...newAsset("project"),
		name: zh ? "旅行清单" : "Travel checklist",
		category: "repository",
	};
	const richItem = {
		...newAsset("item"),
		name: zh ? "工作室笔记本 · Pro 16" : "Studio laptop · Pro 16",
		category: "device",
		location: zh ? "工作室 · 书桌左侧" : "Studio · left desk",
		description: zh
			? "移动剪辑与设计工作站，附购买记录、设备照片和保修期限。"
			: "Editing and design workstation with purchase record, photo and warranty.",
		amount: 869900,
		currency: "CNY",
		itemPurchasePriceKnown: true,
		purchaseDate: "2026-08-16",
		warrantyDate: "2027-08-16",
		itemLifecycleStatus: "inUse",
		attachments: [imageId],
		itemMedia: { coverId: imageId, detailIds: [], receiptIds: [] },
		tags: [zh ? "主力设备" : "Primary device"],
	};
	const simpleItem = {
		...newAsset("item"),
		name: zh ? "随身背包" : "Everyday backpack",
		category: "other",
	};
	const longItem = {
		...newAsset("item"),
		name: zh
			? "多机位外拍套装与备用收音设备的长期借用登记"
			: "Long-term loan register for multi-camera filming and backup audio equipment",
		category: "device",
		location: "A-03 / 2F",
		description:
			"Portable field equipment · " + "LongDescriptionWithoutSpaces".repeat(4),
		amount: 29900,
		itemPurchasePriceKnown: true,
		purchaseDate: "2026-04-01",
		tags: ["Field", "Audio"],
	};
	const subscription = {
		...newAsset("subscription"),
		name: zh ? "CloudNest 云主机" : "CloudNest hosting",
		category: "service",
		amount: 8800,
		currency: "CNY",
		dueDate: "2026-11-03",
		cycle: "month",
		interval: 1,
		description: zh
			? "工作室网站与备份空间"
			: "Studio website and backup storage",
	};
	const simpleSubscription = {
		...newAsset("subscription"),
		name: zh ? "音乐会员" : "Music membership",
		category: "service",
		amount: 0,
		dueDate: "",
	};
	const account = {
		...newAsset("account"),
		name: zh ? "工作室邮箱" : "Studio mailbox",
		category: "email",
		username: "studio@example.test",
		accountProvider: "Synthetic Mail",
	};
	const extra = Array.from({ length: 17 }, (_, index) => ({
		...newAsset(index % 2 ? "project" : "item"),
		category: index % 2 ? "repository" : "other",
		name: `${zh ? "资料" : "Record"} ${String(index + 1).padStart(2, "0")}`,
		...(index % 3 === 0
			? {
					description: zh
						? "资料齐全时，补充说明与期限可直接扫读。"
						: "Additional notes and dates remain easy to scan.",
				}
			: {}),
	}));
	const assets = [
		richProject,
		simpleProject,
		richItem,
		simpleItem,
		longItem,
		subscription,
		simpleSubscription,
		account,
		...extra,
	];
	// Repository order is by record ID. Keep complete and minimal examples together above the fold.
	assets.forEach((asset, index) => {
		asset.id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
	});
	const tasks = Array.from({ length: 6 }, (_, index) =>
		taskSchema.parse({
			id: crypto.randomUUID(),
			assetId: index % 2 ? richItem.id : richProject.id,
			name: `${zh ? "核对交付资料" : "Review delivery record"} ${index + 1}`,
			dueDate: `2026-11-0${index + 1}`,
			done: index === 5,
			createdAt: richProject.createdAt,
		}),
	);
	const history = [20000, 3000, 8800, 28900].map((amount, index) =>
		historySchema.parse({
			id: crypto.randomUUID(),
			assetId: index === 2 ? subscription.id : richProject.id,
			action: "expense",
			amount,
			currency: "CNY",
			title: `${zh ? "工作室支出" : "Studio expense"} ${index + 1}`,
			source: "Synthetic receipt",
			note: "",
			eventDate: `2026-10-2${index + 1}`,
			createdAt: richProject.createdAt,
		}),
	);
	const collections = Array.from({ length: 8 }, (_, index) => ({
		id: crypto.randomUUID(),
		name: `${zh ? "工作分类" : "Collection"} ${index + 1}`,
		assetIds: assets.slice(index, index + 5).map((asset) => asset.id),
	}));
	await saveBatch([
		...assets.map((value) => ({ type: "asset", value })),
		...tasks.map((value) => ({ type: "task", value })),
		...history.map((value) => ({ type: "history", value })),
		{
			type: "relation",
			value: relationSchema.parse({
				id: crypto.randomUUID(),
				from: richProject.id,
				to: subscription.id,
				label: "uses",
				createdAt: richProject.createdAt,
			}),
		},
		{
			type: "preference",
			value: { id: "assetCollectionsV1", value: collections },
		},
	]);
	return {
		project: richProject.id,
		item: richItem.id,
		subscription: subscription.id,
		task: tasks[0].id,
		collections: collections.map((collection) => collection.id),
		assetCount: assets.length,
	};
}
