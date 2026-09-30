import { createHash, randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { selectChoice } from "./helpers/select-choice";

const issuer = process.env.VITE_KEEPANY_BINDING_ISSUER ?? "";
const bridge = process.env.VITE_KEEPANY_BINDING_BRIDGE_ORIGIN ?? "";
const configured =
	issuer === "http://127.0.0.1:3100" && bridge === "http://127.0.0.1:3191";
const webOrigin = `http://127.0.0.1:${process.env.KEEPANY_E2E_PORT ?? "4173"}`;

async function openConnections(page: Page) {
	const connections = page.locator("#connections");
	await expect(connections).toBeVisible();
	if (
		!(await connections.evaluate(
			(element) => (element as HTMLDetailsElement).open,
		))
	) {
		await connections.locator("summary").click();
	}
	await expect(connections).toHaveJSProperty("open", true);
}

test("account binding approval survives reload and remote revoke clears local credential", async ({
	page,
}) => {
	test.skip(!configured, "Run with the fixed local binding fixture origins");
	const { privateKey, publicKey } = await generateKeyPair("RS256", {
		modulusLength: 2048,
	});
	const jwk = {
		...(await exportJWK(publicKey)),
		kid: "browser-test",
		alg: "RS256",
	};
	const bindingId = randomUUID();
	const subject = `keepanyadm:${randomUUID()}`;
	let instanceHash = "";
	let devicePublicKey: unknown;
	let stateProof = "";
	await page.route(`${bridge}/**`, async (route) => {
		const request = route.request();
		const headers = {
			"Access-Control-Allow-Origin": webOrigin,
			"Access-Control-Allow-Methods": "GET, POST",
			"Access-Control-Allow-Headers": "content-type, dpop",
			"Content-Type": "application/json",
		};
		if (request.method() === "OPTIONS") {
			await route.fulfill({ status: 204, headers });
			return;
		}
		let data: unknown;
		const path = new URL(request.url()).pathname;
		if (path.endsWith("/device")) {
			const body = request.postDataJSON() as {
				instanceId: string;
				devicePublicKey: unknown;
			};
			instanceHash = createHash("sha256").update(body.instanceId).digest("hex");
			devicePublicKey = body.devicePublicKey;
			data = {
				deviceCode: "D".repeat(43),
				userCode: "WEB-1234",
				verificationUri: `${issuer}/settings/connect`,
				expiresIn: 300,
				interval: 5,
			};
		} else if (path.endsWith("/poll")) {
			const now = Math.floor(Date.now() / 1000);
			const bindingTicket = await new SignJWT({
				scope: "binding:complete",
				binding_id: bindingId,
				instance_id_hash: instanceHash,
				allowed_scopes: ["sync:read"],
			})
				.setProtectedHeader({ alg: "RS256", kid: "browser-test", typ: "JWT" })
				.setIssuer(issuer)
				.setAudience("keepany-binding")
				.setSubject(subject)
				.setJti(randomUUID())
				.setIssuedAt(now)
				.setExpirationTime(now + 60)
				.sign(privateKey);
			data = {
				status: "approved",
				bindingId,
				subject,
				bindingTicket,
				expiresAt: new Date((now + 60) * 1000).toISOString(),
				retryUntil: new Date(Date.now() + 600_000).toISOString(),
				refreshToken: "R".repeat(43),
				refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			};
		} else if (path === "/.well-known/jwks.json") {
			await route.fulfill({
				status: 200,
				headers,
				body: JSON.stringify({ keys: [jwk] }),
			});
			return;
		} else if (path.endsWith("/state")) {
			stateProof = request.headers().dpop;
			data = { bindingId, state: "revoked" };
		} else {
			throw Error(`Unexpected binding path: ${path}`);
		}
		await route.fulfill({
			status: 200,
			headers,
			body: JSON.stringify({ code: 0, data }),
		});
	});
	await page.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/settings");
	await openConnections(page);
	await page.getByRole("button", { name: "Start connecting" }).click();
	await expect(page.getByText("WEB-1234")).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Open approval page" }),
	).toHaveAttribute("href", `${issuer}/settings/connect`);
	await page.waitForTimeout(5_050);
	await page.getByRole("button", { name: "Check status" }).click();
	await expect(
		page.getByText("Connection saved on this device").first(),
	).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		)
		.toBe(true);
	await page.screenshot({
		path: `${process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-09-28"}/binding-fixture-en-390.png`,
		fullPage: true,
	});
	await selectChoice(
		page
			.locator("section.card")
			.filter({ has: page.getByRole("heading", { name: "Language" }) })
			.getByRole("combobox"),
		"zh-CN",
	);
	await expect(page.getByText("本机已保存账号连接").first()).toBeVisible();
	await page.screenshot({
		path: `${process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-09-28"}/binding-fixture-zh-390.png`,
		fullPage: true,
	});
	await selectChoice(
		page
			.locator("section.card")
			.filter({ has: page.getByRole("heading", { name: "语言" }) })
			.getByRole("combobox"),
		"en",
	);
	await page.reload();
	await openConnections(page);
	await expect(
		page.getByText("Connection saved on this device").first(),
	).toBeVisible();
	await page.getByRole("button", { name: "Check status" }).click();
	await expect(page.getByText("Authorization revoked")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Start connecting" }),
	).toBeVisible();
	expect(devicePublicKey).toMatchObject({ kty: "EC", crv: "P-256" });
	expect(stateProof).toBeTruthy();
});
