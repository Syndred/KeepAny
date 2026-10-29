# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-density.regression-1.spec.ts >> zh-CN 1280px dense records and complete date interaction
- Location: tests\e2e\ui-density.regression-1.spec.ts:19:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.overview-project-card')
Expected: 6
Received: 2
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" locator('.overview-project-card') with timeout 5000ms
  - waiting for locator('.overview-project-card')
    - locator resolved to 0 elements
    - unexpected value "0"
    13 × locator resolved to 2 elements
       - unexpected value "2"

```

# Page snapshot

```yaml
- generic [ref=f2e3]:
  - complementary [ref=f2e4]:
    - generic [ref=f2e5]:
      - generic [aria-hidden] [ref=f2e6]: K
      - generic [ref=f2e7]:
        - strong [ref=f2e8]: KeepAny
        - generic [ref=f2e9]: 个人资产工作台
    - button [ref=f2e10] [cursor=pointer]:
      - strong [ref=f2e15]: 个人工作区
    - generic [ref=f2e18]: 工作空间
    - navigation "导航" [ref=f2e19]:
      - generic [ref=f2e20]:
        - button "概览 按住拖动排序" [ref=f2e21]
        - link "概览" [ref=f2e29] [cursor=pointer]:
          - /url: /
      - generic [ref=f2e36]:
        - button "待办 按住拖动排序" [ref=f2e37]
        - link "待办 5" [ref=f2e45] [cursor=pointer]:
          - /url: /tasks
          - generic [ref=f2e49]: 待办
          - generic [ref=f2e50]: "5"
      - generic [ref=f2e51]:
        - button "资产 按住拖动排序" [ref=f2e52]
        - link "资产" [ref=f2e60] [cursor=pointer]:
          - /url: /assets
      - generic [ref=f2e66]:
        - button "账号 按住拖动排序" [ref=f2e67]
        - link "账号" [ref=f2e75] [cursor=pointer]:
          - /url: /accounts
      - status [ref=f2e80]
    - link "回收站" [ref=f2e81] [cursor=pointer]:
      - /url: /trash
    - generic [ref=f2e85]:
      - generic [ref=f2e86]: 我的分类
      - link "工作分类 1" [ref=f2e87] [cursor=pointer]:
        - /url: /collections/257787c5-3f8e-4ee9-a886-21bc0302dd07
      - link "工作分类 2" [ref=f2e89] [cursor=pointer]:
        - /url: /collections/2feead48-4326-4679-8185-bc5dbc55908e
      - link "工作分类 3" [ref=f2e91] [cursor=pointer]:
        - /url: /collections/1541d7e3-09b4-4cdd-9ecb-8f95e3bab4d5
      - link "工作分类 4" [ref=f2e93] [cursor=pointer]:
        - /url: /collections/009f13ac-4bed-4c47-b401-d98807a55484
      - link "工作分类 5" [ref=f2e95] [cursor=pointer]:
        - /url: /collections/33eaf831-632a-4487-955f-f9d293a8ba9c
      - link "工作分类 6" [ref=f2e97] [cursor=pointer]:
        - /url: /collections/0b3c1de4-6fbb-44dd-9d3c-f8065d23b15b
      - link "工作分类 7" [ref=f2e99] [cursor=pointer]:
        - /url: /collections/b07aec45-fa26-4684-ab08-2b2a9a74fccd
      - link "工作分类 8" [ref=f2e101] [cursor=pointer]:
        - /url: /collections/5b3a305d-9461-40d8-bf9b-a077009baffd
      - link "自定义侧边栏" [ref=f2e103] [cursor=pointer]:
        - /url: /collections
    - button "我 我的工作区 仅自己可见" [ref=f2e106] [cursor=pointer]:
      - generic [ref=f2e107]: 我
      - generic [ref=f2e108]:
        - strong [ref=f2e109]: 我的工作区
        - generic [ref=f2e110]: 仅自己可见
  - generic [ref=f2e113]:
    - banner [ref=f2e114]:
      - strong [ref=f2e115]: 概览
      - button "搜索全部资料" [ref=f2e116] [cursor=pointer]:
        - generic [ref=f2e121]: ⌘ K
      - generic [ref=f2e122]:
        - link "待办提醒" [ref=f2e123] [cursor=pointer]:
          - /url: /tasks
        - button "AI 助手与授权" [ref=f2e128] [cursor=pointer]
        - link "收录与备份" [ref=f2e132] [cursor=pointer]:
          - /url: /intake
    - main [ref=f2e134]:
      - generic [ref=f2e135]:
        - generic [ref=f2e136]:
          - generic [ref=f2e137]: 本地数字资产工作台
          - heading "项目、账号与订阅，一眼掌握。" [level=1] [ref=f2e138]
          - paragraph [ref=f2e139]: 看清项目依赖，记下续费与维护事项。资料保存在当前浏览器。
        - link "探索我的项目" [ref=f2e140] [cursor=pointer]:
          - /url: /assets/project
      - generic [ref=f2e144]:
        - strong [ref=f2e145]: 把分散的资料，整理成下一步。
        - link "快速收录" [ref=f2e146] [cursor=pointer]:
          - /url: /intake
        - link "查看待办" [ref=f2e148] [cursor=pointer]:
          - /url: /tasks
      - generic [ref=f2e151]:
        - generic [ref=f2e152]:
          - generic [ref=f2e153]: 已记录资产
          - strong [ref=f2e157]: "25"
          - generic [ref=f2e158]: 项目、账号、订阅和实物
        - generic [ref=f2e159]:
          - generic [ref=f2e160]: 未来 30 天待处理
          - strong [ref=f2e163]: "6"
          - generic [ref=f2e164]: 其中 5 项需要本周处理
        - generic [ref=f2e165]:
          - generic [ref=f2e166]: 需要核实的关系
          - strong [ref=f2e174]: "0"
          - generic [ref=f2e175]: 未核实或上次确认已超过 90 天
      - generic [ref=f2e176]:
        - generic [ref=f2e177]:
          - generic [ref=f2e178]:
            - generic [ref=f2e179]:
              - heading "下一步要处理" [level=2] [ref=f2e180]
              - paragraph [ref=f2e181]: 按临期程度排列
            - link "查看全部" [ref=f2e182] [cursor=pointer]:
              - /url: /tasks
          - link "核对交付资料 1 松果创作工作室 2026年11月1日" [ref=f2e185] [cursor=pointer]:
            - /url: /tasks
            - generic [ref=f2e190]:
              - strong [ref=f2e191]: 核对交付资料 1
              - generic [ref=f2e192]: 松果创作工作室
            - strong [ref=f2e194]: 2026年11月1日
          - link "核对交付资料 2 工作室笔记本 · Pro 16 2026年11月2日" [ref=f2e195] [cursor=pointer]:
            - /url: /tasks
            - generic [ref=f2e200]:
              - strong [ref=f2e201]: 核对交付资料 2
              - generic [ref=f2e202]: 工作室笔记本 · Pro 16
            - strong [ref=f2e204]: 2026年11月2日
          - link "核对交付资料 3 松果创作工作室 2026年11月3日" [ref=f2e205] [cursor=pointer]:
            - /url: /tasks
            - generic [ref=f2e210]:
              - strong [ref=f2e211]: 核对交付资料 3
              - generic [ref=f2e212]: 松果创作工作室
            - strong [ref=f2e214]: 2026年11月3日
        - generic [ref=f2e215]:
          - generic [ref=f2e217]:
            - heading "账号关系提醒" [level=2] [ref=f2e218]
            - paragraph [ref=f2e219]: 变更前先看影响范围
          - generic [ref=f2e220]: 目前没有需要核实的账号关系。
          - link "1 个账号尚未关联密码库引用 计划中" [ref=f2e221] [cursor=pointer]:
            - /url: /assets/account
            - generic [ref=f2e222]: 1 个账号尚未关联密码库引用
            - generic [ref=f2e223]: 计划中
      - generic [ref=f2e224]:
        - heading "我的项目" [level=2] [ref=f2e225]
        - link "全部项目" [ref=f2e226] [cursor=pointer]:
          - /url: /assets/project
      - generic [ref=f2e229]:
        - link "松 使用中 松果创作工作室 品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。 · https://studio.example.test 1 项资产 0 账号 1 订阅" [ref=f2e230] [cursor=pointer]:
          - /url: /assets/project/10000000-0000-4000-8000-000000000001
          - generic [ref=f2e231]:
            - generic [ref=f2e232]: 松
            - generic [ref=f2e233]: 使用中
          - heading "松果创作工作室" [level=3] [ref=f2e234]
          - paragraph [ref=f2e235]: 品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。 · https://studio.example.test
          - generic [ref=f2e236]:
            - generic [ref=f2e237]:
              - strong [ref=f2e238]: "1"
              - text: 项资产
            - generic [ref=f2e239]:
              - strong [ref=f2e240]: "0"
              - text: 账号
            - generic [ref=f2e241]:
              - strong [ref=f2e242]: "1"
              - text: 订阅
        - link "旅 使用中 旅行清单 项目 0 项资产 0 账号 0 订阅" [ref=f2e243] [cursor=pointer]:
          - /url: /assets/project/10000000-0000-4000-8000-000000000002
          - generic [ref=f2e244]:
            - generic [ref=f2e245]: 旅
            - generic [ref=f2e246]: 使用中
          - heading "旅行清单" [level=3] [ref=f2e247]
          - paragraph [ref=f2e248]: 项目
          - generic [ref=f2e249]:
            - generic [ref=f2e250]:
              - strong [ref=f2e251]: "0"
              - text: 项资产
            - generic [ref=f2e252]:
              - strong [ref=f2e253]: "0"
              - text: 账号
            - generic [ref=f2e254]:
              - strong [ref=f2e255]: "0"
              - text: 订阅
```

# Test source

```ts
  1   | import { mkdirSync } from "node:fs";
  2   | import { join } from "node:path";
  3   | import { expect, test } from "@playwright/test";
  4   | import { resources } from "../../apps/web/src/i18n";
  5   | import { sourceModuleUrl } from "./helpers/source-module-url";
  6   | import { seedDensityBrowser } from "./helpers/ui-density-fixture";
  7   | 
  8   | // Regression: UI-20261028 — whole-field dates, dense mixed records, single active tabs,
  9   | // adjacent collection rows and working workspace menu. User-reported /qa regression.
  10  | // Value: protects=real rendered interaction and data reread; seam=none;
  11  | // no_claim=synthetic local records, no remote service or native notification acceptance.
  12  | const evidence =
  13  | 	process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/ui-migration/density";
  14  | mkdirSync(evidence, { recursive: true });
  15  | test.setTimeout(90_000);
  16  | 
  17  | for (const language of ["zh-CN", "en"] as const)
  18  | 	for (const width of [390, 768, 1280, 1920]) {
  19  | 		test(`${language} ${width}px dense records and complete date interaction`, async ({
  20  | 			page,
  21  | 		}) => {
  22  | 			const errors: string[] = [];
  23  | 			page.on("pageerror", (error) => errors.push(error.message));
  24  | 			await page.setViewportSize({ width, height: 960 });
  25  | 			await page.addInitScript(
  26  | 				(language) => localStorage.setItem("keepany-language", language),
  27  | 				language,
  28  | 			);
  29  | 			await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
  30  | 			await page.goto("/assets");
  31  | 			const ids = await page.evaluate(seedDensityBrowser, {
  32  | 				repositoryPath: sourceModuleUrl("packages/local-db/src/index.ts"),
  33  | 				domainPath: sourceModuleUrl("packages/domain/src/index.ts"),
  34  | 				language,
  35  | 			});
  36  | 			await page.reload();
  37  | 			const t = (key: string) => resources[language].translation[key];
  38  | 			await page.goto("/");
> 39  | 			await expect(page.locator(".overview-project-card")).toHaveCount(6);
      |                                                         ^ Error: expect(locator).toHaveCount(expected) failed
  40  | 			await expect(page.locator(".overview-project-top h3")).toHaveCount(6);
  41  | 			expect(await page.locator(".overview-project-card").evaluateAll((cards) => cards.every((card) => card.getBoundingClientRect().width <= 361))).toBe(true);
  42  | 			if (width >= 1280) expect((await page.locator(".overview-hero").boundingBox())!.height).toBeLessThan(130);
  43  | 			await page.screenshot({path: join(evidence, `dense-overview-${language}-${width}.png`),fullPage: true});
  44  | 			await page.goto("/assets");
  45  | 			const cards = page.locator(".workspace-asset-grid > a");
  46  | 			await expect(cards).toHaveCount(25); // 24 assets in the catalog plus the recorded domain.
  47  | 			await expect(page.locator(".workspace-asset-grid")).toHaveClass(
  48  | 				/asset-dense-list/,
  49  | 			);
  50  | 			if (width >= 1280) {
  51  | 				await expect(
  52  | 					page.locator(".asset-project-foot .chip").first(),
  53  | 				).toBeVisible();
  54  | 				const statusX = await page.evaluate(() =>
  55  | 					[".asset-project-foot .chip", ".asset-library-foot .chip"].map(
  56  | 						(selector) =>
  57  | 							document.querySelector(selector)!.getBoundingClientRect().x,
  58  | 					),
  59  | 				);
  60  | 				expect(Math.abs(statusX[0] - statusX[1])).toBeLessThanOrEqual(1);
  61  | 			}
  62  | 			expect(
  63  | 				await cards.evaluateAll((cards) =>
  64  | 					cards.every((card) => card.getBoundingClientRect().height < 195),
  65  | 				),
  66  | 			).toBe(true);
  67  | 			await page.screenshot({
  68  | 				path: join(evidence, `dense-list-${language}-${width}.png`),
  69  | 				fullPage: true,
  70  | 			});
  71  | 			await page
  72  | 				.getByRole("button", { name: t("assetCardView"), exact: true })
  73  | 				.click();
  74  | 			const rectangles = await cards.evaluateAll((cards) =>
  75  | 				cards.map((card) => ({
  76  | 					width: card.getBoundingClientRect().width,
  77  | 					height: card.getBoundingClientRect().height,
  78  | 					top: card.getBoundingClientRect().top,
  79  | 					bottom: card.getBoundingClientRect().bottom,
  80  | 				})),
  81  | 			);
  82  | 			expect(
  83  | 				rectangles.every((rect) => rect.width <= 361 && rect.height < 440),
  84  | 			).toBe(true);
  85  | 			for (const rect of rectangles) {
  86  | 				const sameRow = rectangles.filter((other) => Math.abs(other.top - rect.top) < 1);
  87  | 				expect(Math.max(...sameRow.map((other) => other.bottom)) - Math.min(...sameRow.map((other) => other.bottom))).toBeLessThanOrEqual(1);
  88  | 			}
  89  | 			await expect(page.locator(".asset-kind-icon img")).toHaveJSProperty(
  90  | 				"naturalWidth",
  91  | 				640,
  92  | 			);
  93  | 			await expect(page.locator(".asset-project-cover")).toHaveCount(0);
  94  | 			if (width >= 1280)
  95  | 				expect(
  96  | 					await cards.evaluateAll(
  97  | 						(cards) =>
  98  | 							cards.filter(
  99  | 								(card) => card.getBoundingClientRect().bottom <= innerHeight,
  100 | 							).length,
  101 | 					),
  102 | 				).toBeGreaterThanOrEqual(6);
  103 | 			await page.screenshot({
  104 | 				path: join(evidence, `dense-assets-${language}-${width}.png`),
  105 | 				fullPage: true,
  106 | 			});
  107 | 			await page
  108 | 				.getByRole("button", { name: t("assetListView"), exact: true })
  109 | 				.click();
  110 | 			for (const path of [
  111 | 				"/assets",
  112 | 				"/assets/project",
  113 | 				"/assets/item",
  114 | 				"/assets/domains",
  115 | 				"/assets/subscription",
  116 | 				"/finance",
  117 | 				"/accounts",
  118 | 				"/assets/vault#vault-references",
  119 | 			]) {
  120 | 				await page.goto(path);
  121 | 				await expect(
  122 | 					page.locator(".workspace-navigation > a[aria-current='page']"),
  123 | 				).toHaveCount(1);
  124 | 				expect(
  125 | 					await page.evaluate(
  126 | 						() => document.documentElement.scrollWidth <= innerWidth + 1,
  127 | 					),
  128 | 				).toBe(true);
  129 | 			}
  130 | 			await page.goto("/collections");
  131 | 			await expect(page.locator(".collections-tile")).toHaveCount(8);
  132 | 			if (width <= 680) {
  133 | 				const target = await page.locator(".collections-tile button[aria-haspopup=menu]").first().boundingBox();
  134 | 				expect(target!.width).toBeGreaterThanOrEqual(44);
  135 | 				expect(target!.height).toBeGreaterThanOrEqual(44);
  136 | 			}
  137 | 			const geometry = await page.evaluate(() => ({
  138 | 				navBottom: document
  139 | 					.querySelector(".collections-organize-nav")!
```