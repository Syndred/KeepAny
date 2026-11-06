import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";
import { newAsset } from "../../../packages/domain/src";
import { UnifiedDetailMetrics } from "./components/UnifiedAssetDetail";

it("keeps zero wallet balances in the existing CNY convention despite a legacy asset currency", async () => {
	const i18n = createInstance();
	await i18n.init({ lng: "en", resources: { en: { translation: {} } } });
	const asset = {
		...newAsset("project"),
		currency: "USD" as const,
		walletCard: {
			type: "storedValue" as const,
			issuer: "Fixture",
			lastFour: "",
			balanceMinor: 0,
			remainingUses: null,
		},
	};
	const html = renderToStaticMarkup(
		createElement(
			I18nextProvider,
			{ i18n },
			createElement(UnifiedDetailMetrics, { asset }),
		),
	);
	expect(html).toContain('data-metric="wallet-primary"');
	expect(html).toContain("CN¥0.00");
	expect(html).not.toContain('data-metric="remaining"');
});
