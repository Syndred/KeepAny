# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-density.regression-1.spec.ts >> zh-CN 1280px dense records and complete date interaction
- Location: tests\e2e\ui-density.regression-1.spec.ts:19:3

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 64
Received:    95
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
        - /url: /collections/8b8ab08e-7e58-40a7-abfe-f86c4306ff2c
      - link "工作分类 2" [ref=f2e89] [cursor=pointer]:
        - /url: /collections/92fb8e57-d2aa-4485-8c7b-3cc3895d9770
      - link "工作分类 3" [ref=f2e91] [cursor=pointer]:
        - /url: /collections/a1d12e59-8ead-4b69-bd68-aa900f124b88
      - link "工作分类 4" [ref=f2e93] [cursor=pointer]:
        - /url: /collections/8ff09db6-f546-4114-baf8-fb86f3c26a62
      - link "工作分类 5" [ref=f2e95] [cursor=pointer]:
        - /url: /collections/8d15099f-6c1a-4ed9-a32a-0bedd0d353ed
      - link "工作分类 6" [ref=f2e97] [cursor=pointer]:
        - /url: /collections/10e428b2-6e75-4402-8f07-8386957e8094
      - link "工作分类 7" [ref=f2e99] [cursor=pointer]:
        - /url: /collections/42dcc711-f8a9-4da5-958d-6127ee77ba28
      - link "工作分类 8" [ref=f2e101] [cursor=pointer]:
        - /url: /collections/55978195-84e6-4260-bcdc-2828a1abfd04
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
    - complementary "需要留意的提醒" [ref=f2e134]:
      - strong [ref=f2e135]: 1 项提醒
      - link "核对交付资料 1" [ref=f2e137] [cursor=pointer]:
        - /url: /tasks#task-ad529273-dcd8-4fdc-b062-bf4fdaa1a425
    - main [ref=f2e138]:
      - generic [ref=f2e139]:
        - generic [ref=f2e140]:
          - heading "概览" [level=1] [ref=f2e141]
          - paragraph [ref=f2e142]: 看清项目依赖，记下续费与维护事项。资料保存在当前浏览器。
        - generic [ref=f2e143]:
          - link "探索我的项目" [ref=f2e144] [cursor=pointer]:
            - /url: /assets/project
          - link "快速收录" [ref=f2e148] [cursor=pointer]:
            - /url: /intake
          - link "查看待办" [ref=f2e150] [cursor=pointer]:
            - /url: /tasks
      - generic [ref=f2e153]:
        - generic [ref=f2e154]:
          - generic [ref=f2e155]: 已记录资产
          - strong [ref=f2e159]: "25"
          - generic [ref=f2e160]: 项目、账号、订阅和实物
        - generic [ref=f2e161]:
          - generic [ref=f2e162]: 未来 30 天待处理
          - strong [ref=f2e165]: "6"
          - generic [ref=f2e166]: 其中 5 项需要本周处理
        - generic [ref=f2e167]:
          - generic [ref=f2e168]: 需要核实的关系
          - strong [ref=f2e176]: "0"
          - generic [ref=f2e177]: 未核实或上次确认已超过 90 天
      - generic [ref=f2e178]:
        - generic [ref=f2e179]:
          - generic [ref=f2e180]:
            - generic [ref=f2e181]:
              - heading "下一步要处理" [level=2] [ref=f2e182]
              - paragraph [ref=f2e183]: 按临期程度排列
            - link "查看全部" [ref=f2e184] [cursor=pointer]:
              - /url: /tasks
          - link "核对交付资料 1 松果创作工作室 2026年10月28日" [ref=f2e187] [cursor=pointer]:
            - /url: /tasks
            - generic [ref=f2e192]:
              - strong [ref=f2e193]: 核对交付资料 1
              - generic [ref=f2e194]: 松果创作工作室
            - strong [ref=f2e196]: 2026年10月28日
          - link "核对交付资料 2 工作室笔记本 · Pro 16 2026年11月2日" [ref=f2e197] [cursor=pointer]:
            - /url: /tasks
            - generic [ref=f2e202]:
              - strong [ref=f2e203]: 核对交付资料 2
              - generic [ref=f2e204]: 工作室笔记本 · Pro 16
            - strong [ref=f2e206]: 2026年11月2日
          - link "核对交付资料 3 松果创作工作室 2026年11月3日" [ref=f2e207] [cursor=pointer]:
            - /url: /tasks
            - generic [ref=f2e212]:
              - strong [ref=f2e213]: 核对交付资料 3
              - generic [ref=f2e214]: 松果创作工作室
            - strong [ref=f2e216]: 2026年11月3日
          - link "CloudNest 云主机 订阅续费 2026年11月3日" [ref=f2e217] [cursor=pointer]:
            - /url: /assets/subscription/10000000-0000-4000-8000-000000000006
            - generic [ref=f2e222]:
              - strong [ref=f2e223]: CloudNest 云主机
              - generic [ref=f2e224]: 订阅续费
            - strong [ref=f2e226]: 2026年11月3日
        - generic [ref=f2e227]:
          - generic [ref=f2e229]:
            - heading "账号关系提醒" [level=2] [ref=f2e230]
            - paragraph [ref=f2e231]: 变更前先看影响范围
          - generic [ref=f2e232]: 目前没有需要核实的账号关系。
          - link "1 个账号尚未关联密码库引用 计划中" [ref=f2e233] [cursor=pointer]:
            - /url: /assets/account
            - generic [ref=f2e234]: 1 个账号尚未关联密码库引用
            - generic [ref=f2e235]: 计划中
      - generic [ref=f2e236]:
        - heading "我的项目" [level=2] [ref=f2e237]
        - link "全部项目" [ref=f2e238] [cursor=pointer]:
          - /url: /assets/project
      - generic [ref=f2e241]:
        - link "松 松果创作工作室 使用中 品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。 · https://studio.example.test 1 项资产 0 账号 1 订阅" [ref=f2e242] [cursor=pointer]:
          - /url: /assets/project/10000000-0000-4000-8000-000000000001
          - generic [ref=f2e243]:
            - generic [ref=f2e244]: 松
            - heading "松果创作工作室" [level=3] [ref=f2e245]
            - generic [ref=f2e246]: 使用中
          - paragraph [ref=f2e247]: 品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。 · https://studio.example.test
          - generic [ref=f2e248]:
            - generic [ref=f2e249]:
              - strong [ref=f2e250]: "1"
              - text: 项资产
            - generic [ref=f2e251]:
              - strong [ref=f2e252]: "0"
              - text: 账号
            - generic [ref=f2e253]:
              - strong [ref=f2e254]: "1"
              - text: 订阅
        - link "旅 旅行清单 使用中 项目 0 项资产 0 账号 0 订阅" [ref=f2e255] [cursor=pointer]:
          - /url: /assets/project/10000000-0000-4000-8000-000000000002
          - generic [ref=f2e256]:
            - generic [ref=f2e257]: 旅
            - heading "旅行清单" [level=3] [ref=f2e258]
            - generic [ref=f2e259]: 使用中
          - paragraph [ref=f2e260]: 项目
          - generic [ref=f2e261]:
            - generic [ref=f2e262]:
              - strong [ref=f2e263]: "0"
              - text: 项资产
            - generic [ref=f2e264]:
              - strong [ref=f2e265]: "0"
              - text: 账号
            - generic [ref=f2e266]:
              - strong [ref=f2e267]: "0"
              - text: 订阅
        - link "资 资料 02 使用中 项目 0 项资产 0 账号 0 订阅" [ref=f2e268] [cursor=pointer]:
          - /url: /assets/project/10000000-0000-4000-8000-000000000010
          - generic [ref=f2e269]:
            - generic [ref=f2e270]: 资
            - heading "资料 02" [level=3] [ref=f2e271]
            - generic [ref=f2e272]: 使用中
          - paragraph [ref=f2e273]: 项目
          - generic [ref=f2e274]:
            - generic [ref=f2e275]:
              - strong [ref=f2e276]: "0"
              - text: 项资产
            - generic [ref=f2e277]:
              - strong [ref=f2e278]: "0"
              - text: 账号
            - generic [ref=f2e279]:
              - strong [ref=f2e280]: "0"
              - text: 订阅
        - link "资 资料 04 使用中 资料齐全时，补充说明与期限可直接扫读。 0 项资产 0 账号 0 订阅" [ref=f2e281] [cursor=pointer]:
          - /url: /assets/project/10000000-0000-4000-8000-000000000012
          - generic [ref=f2e282]:
            - generic [ref=f2e283]: 资
            - heading "资料 04" [level=3] [ref=f2e284]
            - generic [ref=f2e285]: 使用中
          - paragraph [ref=f2e286]: 资料齐全时，补充说明与期限可直接扫读。
          - generic [ref=f2e287]:
            - generic [ref=f2e288]:
              - strong [ref=f2e289]: "0"
              - text: 项资产
            - generic [ref=f2e290]:
              - strong [ref=f2e291]: "0"
              - text: 账号
            - generic [ref=f2e292]:
              - strong [ref=f2e293]: "0"
              - text: 订阅
        - link "资 资料 06 使用中 项目 0 项资产 0 账号 0 订阅" [ref=f2e294] [cursor=pointer]:
          - /url: /assets/project/10000000-0000-4000-8000-000000000014
          - generic [ref=f2e295]:
            - generic [ref=f2e296]: 资
            - heading "资料 06" [level=3] [ref=f2e297]
            - generic [ref=f2e298]: 使用中
          - paragraph [ref=f2e299]: 项目
          - generic [ref=f2e300]:
            - generic [ref=f2e301]:
              - strong [ref=f2e302]: "0"
              - text: 项资产
            - generic [ref=f2e303]:
              - strong [ref=f2e304]: "0"
              - text: 账号
            - generic [ref=f2e305]:
              - strong [ref=f2e306]: "0"
              - text: 订阅
        - link "资 资料 08 使用中 项目 0 项资产 0 账号 0 订阅" [ref=f2e307] [cursor=pointer]:
          - /url: /assets/project/10000000-0000-4000-8000-000000000016
          - generic [ref=f2e308]:
            - generic [ref=f2e309]: 资
            - heading "资料 08" [level=3] [ref=f2e310]
            - generic [ref=f2e311]: 使用中
          - paragraph [ref=f2e312]: 项目
          - generic [ref=f2e313]:
            - generic [ref=f2e314]:
              - strong [ref=f2e315]: "0"
              - text: 项资产
            - generic [ref=f2e316]:
              - strong [ref=f2e317]: "0"
              - text: 账号
            - generic [ref=f2e318]:
              - strong [ref=f2e319]: "0"
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
  39  | 			await expect(page.locator(".reminder-runtime-banner")).toBeVisible();
> 40  | 			if (width >= 1280) expect((await page.locator(".reminder-runtime-banner").boundingBox())!.height).toBeLessThanOrEqual(64);
      |                                                                                                      ^ Error: expect(received).toBeLessThanOrEqual(expected)
  41  | 			await expect(page.locator(".overview-project-card")).toHaveCount(6);
  42  | 			await expect(page.locator(".overview-project-top h3")).toHaveCount(6);
  43  | 			expect(await page.locator(".overview-project-card").evaluateAll((cards) => cards.every((card) => card.getBoundingClientRect().width <= 361))).toBe(true);
  44  | 			if (width >= 1280) expect((await page.locator(".overview-hero").boundingBox())!.height).toBeLessThan(130);
  45  | 			await page.screenshot({path: join(evidence, `dense-overview-${language}-${width}.png`),fullPage: true});
  46  | 			await page.goto("/assets");
  47  | 			const cards = page.locator(".workspace-asset-grid > a");
  48  | 			await expect(cards).toHaveCount(25); // 24 assets in the catalog plus the recorded domain.
  49  | 			await expect(page.locator(".workspace-asset-grid")).toHaveClass(
  50  | 				/asset-dense-list/,
  51  | 			);
  52  | 			if (width >= 1280) {
  53  | 				await expect(
  54  | 					page.locator(".asset-project-foot .chip").first(),
  55  | 				).toBeVisible();
  56  | 				const statusX = await page.evaluate(() =>
  57  | 					[".asset-project-foot .chip", ".asset-library-foot .chip"].map(
  58  | 						(selector) =>
  59  | 							document.querySelector(selector)!.getBoundingClientRect().x,
  60  | 					),
  61  | 				);
  62  | 				expect(Math.abs(statusX[0] - statusX[1])).toBeLessThanOrEqual(1);
  63  | 			}
  64  | 			expect(
  65  | 				await cards.evaluateAll((cards) =>
  66  | 					cards.every((card) => card.getBoundingClientRect().height < 195),
  67  | 				),
  68  | 			).toBe(true);
  69  | 			await page.screenshot({
  70  | 				path: join(evidence, `dense-list-${language}-${width}.png`),
  71  | 				fullPage: true,
  72  | 			});
  73  | 			await page
  74  | 				.getByRole("button", { name: t("assetCardView"), exact: true })
  75  | 				.click();
  76  | 			const rectangles = await cards.evaluateAll((cards) =>
  77  | 				cards.map((card) => ({
  78  | 					width: card.getBoundingClientRect().width,
  79  | 					height: card.getBoundingClientRect().height,
  80  | 					top: card.getBoundingClientRect().top,
  81  | 					bottom: card.getBoundingClientRect().bottom,
  82  | 				})),
  83  | 			);
  84  | 			expect(
  85  | 				rectangles.every((rect) => rect.width <= 361 && rect.height < 440),
  86  | 			).toBe(true);
  87  | 			for (const rect of rectangles) {
  88  | 				const sameRow = rectangles.filter((other) => Math.abs(other.top - rect.top) < 1);
  89  | 				expect(Math.max(...sameRow.map((other) => other.bottom)) - Math.min(...sameRow.map((other) => other.bottom))).toBeLessThanOrEqual(1);
  90  | 			}
  91  | 			await expect(page.locator(".asset-kind-icon img")).toHaveJSProperty(
  92  | 				"naturalWidth",
  93  | 				640,
  94  | 			);
  95  | 			await expect(page.locator(".asset-project-cover")).toHaveCount(0);
  96  | 			if (width >= 1280)
  97  | 				expect(
  98  | 					await cards.evaluateAll(
  99  | 						(cards) =>
  100 | 							cards.filter(
  101 | 								(card) => card.getBoundingClientRect().bottom <= innerHeight,
  102 | 							).length,
  103 | 					),
  104 | 				).toBeGreaterThanOrEqual(6);
  105 | 			await page.screenshot({
  106 | 				path: join(evidence, `dense-assets-${language}-${width}.png`),
  107 | 				fullPage: true,
  108 | 			});
  109 | 			await page
  110 | 				.getByRole("button", { name: t("assetListView"), exact: true })
  111 | 				.click();
  112 | 			for (const path of [
  113 | 				"/assets",
  114 | 				"/assets/project",
  115 | 				"/assets/item",
  116 | 				"/assets/domains",
  117 | 				"/assets/subscription",
  118 | 				"/finance",
  119 | 				"/accounts",
  120 | 				"/assets/vault#vault-references",
  121 | 			]) {
  122 | 				await page.goto(path);
  123 | 				await expect(
  124 | 					page.locator(".workspace-navigation > a[aria-current='page']"),
  125 | 				).toHaveCount(1);
  126 | 				expect(
  127 | 					await page.evaluate(
  128 | 						() => document.documentElement.scrollWidth <= innerWidth + 1,
  129 | 					),
  130 | 				).toBe(true);
  131 | 			}
  132 | 			await page.goto("/collections");
  133 | 			await expect(page.locator(".collections-tile")).toHaveCount(8);
  134 | 			if (width <= 680) {
  135 | 				const target = await page.locator(".collections-tile button[aria-haspopup=menu]").first().boundingBox();
  136 | 				expect(target!.width).toBeGreaterThanOrEqual(44);
  137 | 				expect(target!.height).toBeGreaterThanOrEqual(44);
  138 | 			}
  139 | 			const geometry = await page.evaluate(() => ({
  140 | 				navBottom: document
```