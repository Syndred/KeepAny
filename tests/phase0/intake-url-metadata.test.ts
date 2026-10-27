import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { lookup } from "node:dns/promises";
vi.mock("node:dns/promises", async importOriginal => {
	const original = await importOriginal<typeof import("node:dns/promises")>();
	return { ...original, lookup: vi.fn(original.lookup) };
});
import { createUrlMetadataHandler, isPublicMetadataAddress, readUrlMetadataHtml } from "../../scripts/intake-url-metadata.mjs";

let fixture: Server;
let origin = "";
let requests = 0;
const received: Array<{ cookie?: string; authorization?: string; method?: string }> = [];
beforeAll(async () => {
	fixture = createServer((request, response) => {
		requests++;
		received.push({ cookie: request.headers.cookie, authorization: request.headers.authorization, method: request.method });
		if (request.url === "/redirect") { response.writeHead(302, { location: "/page" }); response.end(); return; }
		if (request.url === "/private-redirect") { response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); response.end(); return; }
		if (request.url === "/loop") { response.writeHead(302, { location: "/loop" }); response.end(); return; }
		if (request.url === "/text") { response.writeHead(200, { "content-type": "text/plain" }); response.end("not HTML"); return; }
		if (request.url === "/too-large") { response.writeHead(200, { "content-type": "text/html", "content-length": String(1024 * 1024 + 1) }); response.end(); return; }
		if (request.url === "/stream-large") { response.writeHead(200, { "content-type": "text/html" }); response.end(Buffer.alloc(1024 * 1024 + 1, 65)); return; }
		if (request.url === "/bad-encoding") { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(Buffer.from([0xff])); return; }
		if (request.url === "/timeout") return;
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end('<!doctype html><html><head><title>Synthetic &amp; title</title><meta name="description" content="合成 description"></head><body><script>throw 1</script></body></html>');
	});
	await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
	const address = fixture.address();
	if (!address || typeof address === "string") throw Error("fixture-address");
	origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
	fixture.closeAllConnections();
	await new Promise<void>(resolve => fixture.close(() => resolve()));
});

test("normal routes reject literal private, reserved, mapped and loopback addresses before any request", async () => {
	const before = requests;
	for (const target of [origin, "http://localhost/", "http://127.1/", "http://0x7f000001/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://10.0.0.1/", "http://169.254.169.254/"]) {
		await expect(readUrlMetadataHtml(target)).rejects.toThrow("metadata-private");
	}
	expect(requests).toBe(before);
	for (const address of ["0.0.0.0", "192.168.1.1", "172.16.0.1", "100.64.0.1", "198.18.0.1", "192.0.2.1", "203.0.113.4", "224.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::", "64:ff9b::7f00:1"]) expect(isPublicMetadataAddress(address), address).toBe(false);
	for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) expect(isPublicMetadataAddress(address), address).toBe(true);
});

test("supported target uses a real bounded GET without cookies or authorization and validates every redirect", async () => {
	const options = { testAllowedOrigins: [origin] };
	const result = await readUrlMetadataHtml(`${origin}/redirect`, options);
	expect(result.url).toBe(`${origin}/page`);
	expect(result.html).toContain("合成 description");
	expect(received.slice(-2)).toEqual([{ cookie: undefined, authorization: undefined, method: "GET" }, { cookie: undefined, authorization: undefined, method: "GET" }]);
	await expect(readUrlMetadataHtml(`${origin}/private-redirect`, options)).rejects.toThrow("metadata-private");
	await expect(readUrlMetadataHtml(`${origin}/loop`, options)).rejects.toThrow("metadata-redirect");
});

test("mixed public/private DNS is blocked and the validated answer is pinned for the actual connection", async () => {
	const dns = vi.mocked(lookup as (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>);
	dns.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
	await expect(readUrlMetadataHtml("http://mixed.synthetic.test/")).rejects.toThrow("metadata-private");
	const fixtureAddress = new URL(origin);
	const controlled = `http://pin.synthetic.test:${fixtureAddress.port}`;
	const beforeCalls = dns.mock.calls.length;
	dns.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
	const result = await readUrlMetadataHtml(`${controlled}/page`, { testAllowedOrigins: [controlled] });
	expect(result.html).toContain("Synthetic &amp; title");
	expect(dns.mock.calls.length - beforeCalls).toBe(1);
	// A native second DNS lookup would fail for this nonexistent host. The real
	// socket succeeded using the one previously validated, pinned address.
});

test("non-HTML, advertised and streamed oversize, invalid encoding and cancellation leave no partial metadata", async () => {
	const options = { testAllowedOrigins: [origin] };
	for (const [path, error] of [["/text", "metadata-type"], ["/too-large", "metadata-limit"], ["/stream-large", "metadata-limit"], ["/bad-encoding", "metadata-encoding"]]) {
		await expect(readUrlMetadataHtml(`${origin}${path}`, options)).rejects.toThrow(error);
	}
	const controller = new AbortController();
	controller.abort();
	await expect(readUrlMetadataHtml(`${origin}/page`, { ...options, signal: controller.signal })).rejects.toThrow("metadata-timeout");
	for (const url of ["file:///C:/secret", "data:text/html,secret", "javascript:alert(1)", "https://user:password@example.com/"]) await expect(readUrlMetadataHtml(url)).rejects.toThrow("metadata-url");
});

test("a stalled real response times out and closes the request", { timeout: 12000 }, async () => {
	await expect(readUrlMetadataHtml(`${origin}/timeout`, { testAllowedOrigins: [origin] })).rejects.toThrow("metadata-timeout");
});

test("same-origin API rejects cross-origin, missing header, wrong Host, wrong body and client-supplied exceptions", async () => {
	const handle = createUrlMetadataHandler("http://127.0.0.1:4205", { testAllowedOrigins: [origin] });
	const request = (body: unknown, change: Record<string, string> = {}) => new Request("http://127.0.0.1:4205/__keepany_intake__/url-metadata", {
		method: "POST", headers: { host: "127.0.0.1:4205", origin: "http://127.0.0.1:4205", "content-type": "application/json", "x-keepany-intake": "metadata", ...change }, body: JSON.stringify(body),
	});
	const forbiddenHeaders: Array<Record<string, string>> = [{ origin: "https://attacker.invalid" }, { origin: "null" }, { "x-keepany-intake": "" }, { host: "attacker.invalid" }, { "sec-fetch-site": "cross-site" }];
	for (const change of forbiddenHeaders) expect((await handle(request({ url: `${origin}/page` }, change))).status).toBe(403);
	expect((await handle(request({ url: `${origin}/page`, testAllowedOrigins: [origin] }))).status).toBe(400);
	expect((await handle(request({ url: `${origin}/page` }, { "content-type": "text/plain" }))).status).toBe(415);
	expect((await handle(request({ url: "x".repeat(5000) }))).status).toBe(413);
	const success = await handle(request({ url: `${origin}/page` }));
	expect(success.status).toBe(200);
	expect(success.headers.get("cache-control")).toBe("no-store");
	expect((await success.json()).url).toBe(`${origin}/page`);
});

test("one handler limits concurrent requests to four and frees slots after cancellation", async () => {
	const handler = createUrlMetadataHandler("http://127.0.0.1:4205", { testAllowedOrigins: [origin] });
	const controllers = Array.from({ length: 4 }, () => new AbortController());
	const makeRequest = (path: string, signal?: AbortSignal) => new Request("http://127.0.0.1:4205/__keepany_intake__/url-metadata", {
		method: "POST", headers: { host: "127.0.0.1:4205", origin: "http://127.0.0.1:4205", "content-type": "application/json", "x-keepany-intake": "metadata" }, body: JSON.stringify({ url: `${origin}${path}` }), signal,
	});
	const held = controllers.map(controller => handler(makeRequest("/timeout", controller.signal)));
	expect((await handler(makeRequest("/page"))).status).toBe(429);
	for (const controller of controllers) controller.abort();
	expect((await Promise.all(held)).every(response => response.status === 422)).toBe(true);
	expect((await handler(makeRequest("/page"))).status).toBe(200);
});
