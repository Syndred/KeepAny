import { ArrowUpRight, Download, FolderKanban, KeyRound, Link2, ListChecks } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../web/src/components/ui/button";
import { TextLink } from "../web/src/components/ui/text-link";

export type PublicLocale = "en" | "zh-CN";

export type PublicSiteConfig = {
	siteUrl: string;
	downloadUrl: string;
	repositoryUrl: string;
	screenshotSize: { width: number; height: number };
};

const copy = {
	en: {
		lang: "en",
		title: "KeepAny — a local digital asset workspace for independent developers",
		description: "KeepAny connects your projects, domains, accounts, subscriptions, and maintenance in one local workspace. Open-source core, no registration required.",
		keywords: "KeepAny, StackPerch, local digital asset workspace, independent developers, projects, domains, accounts, subscriptions",
		navFeatures: "What it does",
		navTry: "Try locally",
		language: "简体中文",
		languageLabel: "Read this page in Simplified Chinese",
		eyebrow: "Local first · Open source",
		hero: "Your projects have connections. Keep them together.",
		lead: "KeepAny, previously published as StackPerch, is a local digital asset workspace for independent developers. Find the accounts, domains, subscriptions, and maintenance behind each project. Older StackPerch GitHub links still redirect to KeepAny.",
		download: "View preview releases",
		source: "Browse the source",
		preview: "Early preview · Node.js 22+ · No registration",
		screenshotAlt: "KeepAny overview with fictional project, email account, subscription, and maintenance records",
		screenshotCaption: "The actual app, shown with fictional sample records.",
		problemTitle: "What still depends on that account?",
		problem: "When you change an email or retire a project, scattered bookmarks and spreadsheets make it easy to miss a subscription or a login. KeepAny lets you record the connections and turn them into a checklist you can review.",
		featuresTitle: "A workspace for records and the work around them",
		features: [
			{ title: "Projects and connections", text: "Connect project websites and domains to accounts, subscriptions, and devices. Search your records or follow the connection graph." },
			{ title: "Costs and maintenance", text: "Record renewal dates, subscription cycles, tasks, warranties, and lending history. Payment records are your ledger, not proof of a charge." },
			{ title: "Review before saving", text: "Import scattered records, check candidates, and confirm what to keep. Optional AI uses a provider or compatible server you configure." },
			{ title: "A separate password vault", text: "Keep login details in an encrypted KDBX vault with import and export. Passwords stay outside ordinary assets, search, and MCP." },
		],
		tryTitle: "Try one project from start to restore",
		tryLead: "Download the current KeepAny portable preview from the Releases page. It needs Node.js 22 or newer, with no Git, pnpm, or build step. Read that release's verified environments and limits.",
		steps: [
			"Extract the package. Run start.command on macOS, start.sh on Linux, or start.bat on Windows.",
			"Open http://127.0.0.1:4180/. Choose Start with sample records in an empty Overview, then Add sample records in Settings, or create a fictional project.",
			"Connect an account, record a subscription, and create a maintenance task.",
			"Create and save an encrypted .ka1 backup. Restore it in a clean browser profile and check your records.",
		],
		guide: "Read the trial guide",
		dataTitle: "Local storage, with a way to take your data out",
		data: "Keep using the same browser profile and address to continue using your KeepAny or StackPerch records. Existing .ka1 backups and .kdbx vaults remain usable with their original passwords. Records belong to the current browser profile and address. A different browser or port opens a different store; clearing site data can remove it. Download backups regularly and verify that they restore. The local core works without an official account or paid service.",
		ai: "AI is optional. Ordinary Q&A sends only limited fields from records you select. The vault's full-text AI import can send the current list, including passwords and notes, after you review the model, destination, and scope. It does not send your existing vault or master password. Review candidates before saving.",
		limitsTitle: "An early preview with clear limits",
		limits: "Local features have automated and browser verification, but defects may remain. Physical phones, every OS and browser, low-storage conditions, and sudden shutdowns have not all been verified. PDF intake, remote backups, and sync are not provided. Password autofill, cross-device password sync, background email, and closed-page push are also unavailable.",
		hosting: "The local core is open source under AGPL-3.0-only. Optional future hosting belongs to a separate commercial project; official cloud sync and paid services are not open. The current app focuses on local records, KDBX, and encrypted backup/restore. MCP remains experimental and is not required for a local trial.",
		feedbackTitle: "Help make the next step easier",
		feedback: "Tell us where a workflow failed, which record was hard to find, or where entry took too long. Report reproducible steps with fictional data. Keep real passwords, API keys, and backups out of public reports.",
		issues: "Report an issue",
		security: "Security reporting",
		license: "AGPL-3.0-only",
		readme: "README",
		footer: "KeepAny · English and Simplified Chinese · Local core + optional future hosting",
	},
	"zh-CN": {
		lang: "zh-CN",
		title: "KeepAny — 独立开发者的本地数字资产工作台",
		description: "KeepAny 把项目、域名、账号、订阅和维护事项连起来。开源本地核心，无需注册，支持简体中文和英语。",
		keywords: "KeepAny, StackPerch, 本地数字资产工作台, 独立开发者, 项目, 域名, 账号, 订阅",
		navFeatures: "可以做什么",
		navTry: "本地试用",
		language: "English",
		languageLabel: "Read this page in English",
		eyebrow: "本地优先 · 开源",
		hero: "项目背后的账号与订阅，一起理清。",
		lead: "KeepAny（曾以 StackPerch 名称发布）是独立开发者的本地数字资产工作台。把项目、域名、账号、订阅和维护事项连起来，找到下一步该处理的事。旧 StackPerch GitHub 链接仍转到 KeepAny。",
		download: "查看测试版发布",
		source: "查看源码",
		preview: "早期测试版 · Node.js 22+ · 无需注册",
		screenshotAlt: "KeepAny 概览，展示虚构的项目、邮箱账号、订阅和维护资料",
		screenshotCaption: "真实应用界面，内容为虚构的示例资料。",
		problemTitle: "换个邮箱，会影响哪些服务？",
		problem: "换邮箱或停掉一个项目时，分散的书签和表格容易漏掉账号、订阅和续费。KeepAny 记录它们之间的关联，再整理成你可以逐项核对的检查清单。",
		featuresTitle: "资料和围绕它的维护，放在一起",
		features: [
			{ title: "项目与关联", text: "把项目网站和域名与账号、订阅、设备连起来。搜索资料，或沿关系图找到依赖。" },
			{ title: "费用与维护", text: "记录续费日期、订阅周期、待办、保修和借还历史。本机付款台账不代表第三方已经扣款。" },
			{ title: "核对后再收录", text: "整理散落的记录，预览候选并确认保留内容。可选 AI 使用你配置的模型提供商或兼容服务。" },
			{ title: "独立密码库", text: "登录资料保存在加密 KDBX，支持导入与导出。密码不进入普通资产、搜索或 MCP。" },
		],
		tryTitle: "用一个项目，试到备份恢复",
		tryLead: "从 Releases 下载当前 KeepAny 便携测试包。需要 Node.js 22 或更新版本，无需 Git、pnpm 或编译。实际验证的系统与限制以对应发布说明为准。",
		steps: [
			"解压便携包。macOS 用 start.command，Linux 用 start.sh，Windows 用 start.bat。",
			"打开 http://127.0.0.1:4180/，空白概览点「用示例资料开始」，到设置点「加入示例资料」，或建立虚构项目。",
			"关联账号、记录订阅，再建立一项维护待办。",
			"创建并下载加密 .ka1 备份，在干净浏览器配置中恢复并核对资料。",
		],
		guide: "阅读试用指南",
		dataTitle: "资料在本机，也能完整带走",
		data: "使用原浏览器配置、原地址即可继续使用 KeepAny 或 StackPerch 已有资料，旧 .ka1 备份和 .kdbx 密码库可用原密码恢复。资料属于当前浏览器配置和地址。换浏览器或端口会打开另一份资料，清除站点数据可能删除它。定期下载备份并验证恢复。本地核心无需官方账号，也不以付费为条件。",
		ai: "AI 是可选的。普通问答仅发送你选择的有限资料字段；独立密码库的全文 AI 导入，在核对模型、地址和范围后，会发送本次清单，包括其中的密码和备注。它不发送已有全库或主密码。识别结果核对后才保存。",
		limitsTitle: "早期测试版，范围说清楚",
		limits: "本地功能已有自动化和浏览器验证，仍可能有缺陷。真实手机、所有系统与浏览器、低存储及突然断电等条件未全部验证。当前不提供 PDF 收录、远端备份或同步；密码自动填充、跨设备密码同步、后台邮件与关页推送也尚未提供。",
		hosting: "本地核心使用 AGPL-3.0-only 开源。未来托管属于独立商业项目，当前官方云同步和付费服务未开放。正式应用聚焦本地资料、KDBX 与加密备份恢复，MCP 仍为实验能力，不作为本地试用必需步骤。",
		feedbackTitle: "让下一步更省事",
		feedback: "欢迎反馈哪个流程失败、哪份资料难找、哪里录入费时。用虚构资料提供可复现步骤，真实密码、API Key 和备份不要上传到公开问题。",
		issues: "反馈问题",
		security: "安全报告方式",
		license: "AGPL-3.0-only",
		readme: "README",
		footer: "KeepAny · 简体中文与英语 · 本地核心＋未来可选托管",
	},
} as const;

const featureIcons = [FolderKanban, ListChecks, Link2, KeyRound];

export function renderPublicPage(locale: PublicLocale, config: PublicSiteConfig) {
	const c = copy[locale];
	const isEnglish = locale === "en";
	const assets = isEnglish ? "assets/" : "../assets/";
	const canonical = `${config.siteUrl}${isEnglish ? "" : "zh/"}`;
	const screenshot = `overview-${isEnglish ? "en" : "zh"}.png`;
	const readme = `${config.repositoryUrl}/blob/main/${isEnglish ? "README.en.md" : "README.md"}`;
	const structuredData = {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "KeepAny",
		alternateName: "StackPerch",
		url: canonical,
		description: c.description,
		applicationCategory: "UtilitiesApplication",
		operatingSystem: "Web browser with a local Node.js 22+ server",
		inLanguage: ["en", "zh-CN"],
		license: `${config.repositoryUrl}/blob/main/LICENSE`,
		sameAs: config.repositoryUrl,
		screenshot: `${config.siteUrl}assets/${screenshot}`,
		isAccessibleForFree: true,
	};
	const markup = renderToStaticMarkup(
		<html lang={c.lang}>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>{c.title}</title>
				<meta name="description" content={c.description} />
				<meta name="keywords" content={c.keywords} />
				<meta name="robots" content="index,follow" />
				<link rel="canonical" href={canonical} />
				<link rel="alternate" hrefLang="en" href={config.siteUrl} />
				<link rel="alternate" hrefLang="zh-CN" href={`${config.siteUrl}zh/`} />
				<link rel="alternate" hrefLang="x-default" href={config.siteUrl} />
				<meta property="og:type" content="website" />
				<meta property="og:site_name" content="KeepAny" />
				<meta property="og:title" content={c.title} />
				<meta property="og:description" content={c.description} />
				<meta property="og:url" content={canonical} />
				<meta property="og:locale" content={isEnglish ? "en_US" : "zh_CN"} />
				<meta property="og:locale:alternate" content={isEnglish ? "zh_CN" : "en_US"} />
				<meta property="og:image" content={`${config.siteUrl}assets/${screenshot}`} />
				<meta property="og:image:alt" content={c.screenshotAlt} />
				<meta property="og:image:width" content={String(config.screenshotSize.width)} />
				<meta property="og:image:height" content={String(config.screenshotSize.height)} />
				<meta name="twitter:card" content="summary_large_image" />
				<link rel="icon" href={`${assets}keepany.svg`} type="image/svg+xml" />
				<link rel="stylesheet" href={`${assets}public.css`} />
				<script type="application/ld+json">{JSON.stringify(structuredData).replace(/</g, "\\u003c")}</script>
			</head>
			<body>
				<div className="public-page">
					<header className="public-header">
						<a className="brand" href={isEnglish ? "./" : "../"} aria-label="KeepAny">
							<span aria-hidden="true">K</span><span>KeepAny</span>
						</a>
						<nav aria-label={isEnglish ? "Main navigation" : "主导航"}>
							<TextLink href="#features">{c.navFeatures}</TextLink>
							<TextLink href="#try">{c.navTry}</TextLink>
							<TextLink href={isEnglish ? "zh/" : "../"} hrefLang={isEnglish ? "zh-CN" : "en"} aria-label={c.languageLabel}>{c.language}</TextLink>
						</nav>
					</header>
					<main>
						<section className="public-hero" aria-labelledby="hero-title">
							<div className="public-hero-copy">
								<p className="eyebrow">{c.eyebrow}</p>
								<h1 id="hero-title">{c.hero}</h1>
								<p className="public-lead">{c.lead}</p>
								<div className="public-actions">
									<Button asChild variant="primary"><a href={config.downloadUrl}><Download aria-hidden="true" />{c.download}</a></Button>
									<Button asChild><a href={config.repositoryUrl}>{c.source}<ArrowUpRight aria-hidden="true" /></a></Button>
								</div>
								<p className="public-preview">{c.preview}</p>
							</div>
							<figure className="public-screen">
								<img src={`${assets}${screenshot}`} width={config.screenshotSize.width} height={config.screenshotSize.height} alt={c.screenshotAlt} />
								<figcaption>{c.screenshotCaption}</figcaption>
							</figure>
						</section>
						<section className="public-question public-section" aria-labelledby="problem-title">
							<h2 id="problem-title">{c.problemTitle}</h2><p>{c.problem}</p>
						</section>
						<section id="features" className="public-section" aria-labelledby="features-title">
							<h2 id="features-title">{c.featuresTitle}</h2>
							<div className="public-feature-grid">
								{c.features.map((feature, index) => {
									const Icon = featureIcons[index];
									return <article className="card public-feature" key={feature.title}><Icon aria-hidden="true" /><h3>{feature.title}</h3><p>{feature.text}</p></article>;
								})}
							</div>
						</section>
						<section id="try" className="public-section public-try" aria-labelledby="try-title">
							<div><h2 id="try-title">{c.tryTitle}</h2><p>{c.tryLead}</p><TextLink href={`${config.repositoryUrl}/blob/main/docs/试用指南.md${isEnglish ? "#english" : ""}`}>{c.guide}<ArrowUpRight aria-hidden="true" /></TextLink></div>
							<ol>{c.steps.map(step => <li key={step}>{step}</li>)}</ol>
						</section>
						<section className="public-section public-data" aria-labelledby="data-title">
							<h2 id="data-title">{c.dataTitle}</h2><p>{c.data}</p><p>{c.ai}</p>
						</section>
						<section className="public-section" aria-labelledby="limits-title">
							<h2 id="limits-title">{c.limitsTitle}</h2><p>{c.limits}</p><p>{c.hosting}</p>
						</section>
						<section className="public-section public-feedback" aria-labelledby="feedback-title">
							<div><h2 id="feedback-title">{c.feedbackTitle}</h2><p>{c.feedback}</p></div>
							<div className="public-actions"><Button asChild><a href={`${config.repositoryUrl}/issues`}>{c.issues}<ArrowUpRight aria-hidden="true" /></a></Button><TextLink href={`${config.repositoryUrl}/blob/main/SECURITY.md`}>{c.security}</TextLink></div>
						</section>
					</main>
					<footer className="public-footer"><p>{c.footer}</p><div><TextLink href={readme}>{c.readme}</TextLink><TextLink href={`${config.repositoryUrl}/blob/main/LICENSE`}>{c.license}</TextLink><TextLink href={`${config.repositoryUrl}/blob/main/CONTRIBUTING.md`}>GitHub</TextLink></div></footer>
				</div>
			</body>
		</html>,
	);
	return `<!doctype html>\n${markup}\n`;
}
