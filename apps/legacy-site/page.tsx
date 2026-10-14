import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../web/src/components/ui/button";
import { TextLink } from "../web/src/components/ui/text-link";

export const TARGET_SITE_URL = "https://syndred.github.io/StackPerch/";
export type LegacyLocale = "en" | "zh-CN";
export const knownLegacyPaths: Record<string, string> = {
	"/KeepAny": "/StackPerch/",
	"/KeepAny/": "/StackPerch/",
	"/KeepAny/index.html": "/StackPerch/",
	"/KeepAny/zh": "/StackPerch/zh/",
	"/KeepAny/zh/": "/StackPerch/zh/",
	"/KeepAny/zh/index.html": "/StackPerch/zh/",
};

const copy = {
	en: {
		title: "StackPerch has a new address",
		text: "KeepAny is now StackPerch. Continue to the official website.",
		action: "Continue to StackPerch",
		other: "简体中文",
		waiting: "If this page stays open, use the link below.",
	},
	"zh-CN": {
		title: "StackPerch 官网已迁移",
		text: "KeepAny 现名 StackPerch。请前往新的官网入口。",
		action: "前往 StackPerch",
		other: "English",
		waiting: "若页面未自动跳转，请点击下方链接。",
	},
};

function document(
	locale: LegacyLocale,
	title: string,
	content: ReactNode,
	redirect?: string,
	script?: string,
) {
	return `<!doctype html>\n${renderToStaticMarkup(
		<html lang={locale}>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>{title}</title>
				<meta name="robots" content="noindex,follow" />
				<link rel="canonical" href={redirect ?? TARGET_SITE_URL} />
				{redirect && (
					<meta httpEquiv="refresh" content={`0; url=${redirect}`} />
				)}
				<link rel="stylesheet" href="/assets/legacy.css" />
				<link rel="icon" type="image/svg+xml" href="/assets/stackperch.svg" />
			</head>
			<body>
				<div className="public-page legacy-page">
					<header className="public-header">
						<a className="brand" href={TARGET_SITE_URL} aria-label="StackPerch">
							<span aria-hidden="true">S</span>
							<span>StackPerch</span>
						</a>
					</header>
					<main>
						<section
							className="public-hero-copy legacy-card"
							aria-labelledby="legacy-title"
						>
							<h1 id="legacy-title">{title}</h1>
							{content}
						</section>
					</main>
				</div>
				{script && <script>{script}</script>}
			</body>
		</html>,
	)}\n`;
}

// Adapted from jekyll-redirect-from; upstream template and MIT notice are retained in vendor/.
// Fixed same-origin pathname prevents query parameters or fragments from choosing a destination.
export function renderLegacyRedirect(locale: LegacyLocale) {
	const c = copy[locale];
	const path = locale === "en" ? "/StackPerch/" : "/StackPerch/zh/";
	const destination = new URL(path, TARGET_SITE_URL).href;
	const other = locale === "en" ? `${TARGET_SITE_URL}zh/` : TARGET_SITE_URL;
	const script = `location.replace(${JSON.stringify(path)} + location.search + location.hash);`;
	return document(
		locale,
		c.title,
		<>
			<p>{c.text}</p>
			<p>{c.waiting}</p>
			<div className="public-actions">
				<Button asChild variant="primary">
					<a href={destination}>{c.action}</a>
				</Button>
				<TextLink href={other} hrefLang={locale === "en" ? "zh-CN" : "en"}>
					{c.other}
				</TextLink>
			</div>
		</>,
		destination,
		script,
	);
}

export function renderMirrorIndex() {
	return document(
		"en",
		"StackPerch · KeepAny",
		<>
			<p>StackPerch, formerly KeepAny. Choose your language.</p>
			<p>StackPerch 原名 KeepAny。请选择语言。</p>
			<div className="public-actions">
				<Button asChild variant="primary">
					<a href="/KeepAny/">English</a>
				</Button>
				<Button asChild>
					<a href="/KeepAny/zh/" hrefLang="zh-CN">
						简体中文
					</a>
				</Button>
			</div>
		</>,
	);
}

export function renderLegacyNotFound() {
	const routes = JSON.stringify(knownLegacyPaths);
	const script = `const routes = ${routes}; const target = Object.hasOwn(routes, location.pathname) ? routes[location.pathname] : null; if (target) location.replace(target + location.search + location.hash);`;
	return document(
		"en",
		"Page not found · 页面未找到",
		<>
			<p>This page could not be found. Visit the StackPerch website.</p>
			<p>未找到这个页面。请前往 StackPerch 官网。</p>
			<div className="public-actions">
				<Button asChild variant="primary">
					<a href={TARGET_SITE_URL}>English</a>
				</Button>
				<Button asChild>
					<a href={`${TARGET_SITE_URL}zh/`} hrefLang="zh-CN">
						简体中文
					</a>
				</Button>
			</div>
		</>,
		undefined,
		script,
	);
}
