# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-density.regression-1.spec.ts >> zh-CN 1280px dense records and complete date interaction
- Location: tests\e2e\ui-density.regression-1.spec.ts:19:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.asset-project-foot .chip').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('.asset-project-foot .chip').first() with timeout 5000ms
  - waiting for locator('.asset-project-foot .chip').first()

```

```yaml
- complementary:
  - strong: KeepAny
  - text: 个人资产工作台
  - button "个人工作区":
    - strong: 个人工作区
  - text: 工作空间
  - navigation "导航":
    - button "概览 按住拖动排序"
    - link "概览":
      - /url: /
    - button "待办 按住拖动排序"
    - link "待办 5":
      - /url: /tasks
    - button "资产 按住拖动排序"
    - link "资产":
      - /url: /assets
    - button "账号 按住拖动排序"
    - link "账号":
      - /url: /accounts
    - status
  - link "回收站":
    - /url: /trash
  - text: 我的分类
  - link "工作分类 1":
    - /url: /collections/e123c7dd-71d6-46bb-b5a3-b97073fb8e5f
  - link "工作分类 2":
    - /url: /collections/f6676913-b1b7-4bde-aafd-05cb73914354
  - link "工作分类 3":
    - /url: /collections/a45b04c9-4497-4596-bbaa-d7b87c5bd320
  - link "工作分类 4":
    - /url: /collections/a0781930-c98c-4c88-913c-dc6e0fa8f994
  - link "工作分类 5":
    - /url: /collections/241282c1-ae2e-413c-bbe4-3ecadd6649cb
  - link "工作分类 6":
    - /url: /collections/39bf5014-961a-49b8-bbb4-6c136fbdafe7
  - link "工作分类 7":
    - /url: /collections/a937e05c-b3ed-466e-bf57-9d2052ed1719
  - link "工作分类 8":
    - /url: /collections/4a694ade-b3f7-409d-b702-e6aa34ace74b
  - link "自定义侧边栏":
    - /url: /collections
  - button "我 我的工作区 仅自己可见":
    - text: 我
    - strong: 我的工作区
    - text: 仅自己可见
- banner:
  - link "返回概览":
    - /url: /
  - button "搜索全部资料": 搜索全部资料 ⌘ K
  - link "待办提醒":
    - /url: /tasks
  - button "AI 助手与授权"
  - link "收录与备份":
    - /url: /intake
- navigation "资产":
  - link "全部":
    - /url: /assets
  - link "项目":
    - /url: /assets/project
  - link "实物":
    - /url: /assets/item
  - link "域名":
    - /url: /assets/domains
  - link "订阅":
    - /url: /assets/subscription
  - link "费用账本":
    - /url: /finance
- main:
  - heading "资产" [level=1]
  - paragraph: 查看实物、项目、域名与订阅的进度、期限和费用。
  - button "新增资产"
  - text: 实物购入额
  - strong: ¥8,998.00
  - text: 已记录支出
  - strong: ¥607.00
  - text: 订阅月均预计
  - strong: ¥88.00
  - text: 30 天内到期／续费
  - strong: "1"
  - searchbox "搜索资产"
  - group "资产视图":
    - button "紧凑列表" [pressed]
    - button "卡片"
  - text: 25 项资产
  - region "资产":
    - link "松果创作工作室 使用中 品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。 待办完成 0 / 3 0 关联年费预计 ¥1,176.00 已记录支出 ¥607.00 studio.example.test 外链 0 条 · 0 条待核验":
      - /url: /assets/project/10000000-0000-4000-8000-000000000001
      - strong: 松果创作工作室
      - text: 使用中
      - paragraph: 品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。
      - strong: 待办完成 0 / 3
      - progressbar "待办"
      - text: 关联年费预计 ¥1,176.00 已记录支出 ¥607.00 studio.example.test 外链 0 条 · 0 条待核验
    - link "旅行清单 使用中 尚未设置待办 仓库 外链 0 条 · 0 条待核验":
      - /url: /assets/project/10000000-0000-4000-8000-000000000002
      - strong: 旅行清单
      - text: 使用中
      - strong: 尚未设置待办
      - text: 仓库 外链 0 条 · 0 条待核验
    - 'link "工作室笔记本 · Pro 16 移动剪辑与设计工作站，附购买记录、设备照片和保修期限。 数码设备 工作室 · 书桌左侧 保修到期: 2027年8月16日 已购买 73 天 购入价 ¥8,699.00 使用中"':
      - /url: /assets/item/10000000-0000-4000-8000-000000000003
      - strong: 工作室笔记本 · Pro 16
      - text: "移动剪辑与设计工作站，附购买记录、设备照片和保修期限。 数码设备 工作室 · 书桌左侧 保修到期: 2027年8月16日"
      - strong: 已购买 73 天
      - text: 购入价 ¥8,699.00 使用中
    - link "随身背包 其他 未记录购买日期 购入价 未记录金额 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000004
      - strong: 随身背包
      - text: 其他
      - strong: 未记录购买日期
      - text: 购入价 未记录金额 使用中
    - link "多机位外拍套装与备用收音设备的长期借用登记 Portable field equipment · LongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpaces 数码设备 A-03 / 2F 已购买 210 天 购入价 ¥299.00 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000005
      - strong: 多机位外拍套装与备用收音设备的长期借用登记
      - text: Portable field equipment · LongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpaces 数码设备 A-03 / 2F
      - strong: 已购买 210 天
      - text: 购入价 ¥299.00 使用中
    - 'link "CloudNest 云主机 工作室网站与备份空间 ¥88.00 1 月 下次日期: 2026年11月3日 剩余 6 天 已记录支出 ¥88.00 使用中"':
      - /url: /assets/subscription/10000000-0000-4000-8000-000000000006
      - strong: CloudNest 云主机
      - text: "工作室网站与备份空间 ¥88.00 1 月 下次日期: 2026年11月3日"
      - strong: 剩余 6 天
      - text: 已记录支出 ¥88.00 使用中
    - link "音乐会员 ¥0.00 1 月 未记录到期日期 使用中":
      - /url: /assets/subscription/10000000-0000-4000-8000-000000000007
      - strong: 音乐会员
      - text: ¥0.00 1 月
      - strong: 未记录到期日期
      - text: 使用中
    - link "资料 01 资料齐全时，补充说明与期限可直接扫读。 其他 未记录购买日期 购入价 未记录金额 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000009
      - strong: 资料 01
      - text: 资料齐全时，补充说明与期限可直接扫读。 其他
      - strong: 未记录购买日期
      - text: 购入价 未记录金额 使用中
    - link "资料 02 使用中 尚未设置待办 仓库 外链 0 条 · 0 条待核验":
      - /url: /assets/project/10000000-0000-4000-8000-000000000010
      - strong: 资料 02
      - text: 使用中
      - strong: 尚未设置待办
      - text: 仓库 外链 0 条 · 0 条待核验
    - link "资料 03 其他 未记录购买日期 购入价 未记录金额 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000011
      - strong: 资料 03
      - text: 其他
      - strong: 未记录购买日期
      - text: 购入价 未记录金额 使用中
    - link "资料 04 使用中 资料齐全时，补充说明与期限可直接扫读。 尚未设置待办 仓库 外链 0 条 · 0 条待核验":
      - /url: /assets/project/10000000-0000-4000-8000-000000000012
      - strong: 资料 04
      - text: 使用中
      - paragraph: 资料齐全时，补充说明与期限可直接扫读。
      - strong: 尚未设置待办
      - text: 仓库 外链 0 条 · 0 条待核验
    - link "资料 05 其他 未记录购买日期 购入价 未记录金额 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000013
      - strong: 资料 05
      - text: 其他
      - strong: 未记录购买日期
      - text: 购入价 未记录金额 使用中
    - link "资料 06 使用中 尚未设置待办 仓库 外链 0 条 · 0 条待核验":
      - /url: /assets/project/10000000-0000-4000-8000-000000000014
      - strong: 资料 06
      - text: 使用中
      - strong: 尚未设置待办
      - text: 仓库 外链 0 条 · 0 条待核验
    - link "资料 07 资料齐全时，补充说明与期限可直接扫读。 其他 未记录购买日期 购入价 未记录金额 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000015
      - strong: 资料 07
      - text: 资料齐全时，补充说明与期限可直接扫读。 其他
      - strong: 未记录购买日期
      - text: 购入价 未记录金额 使用中
    - link "资料 08 使用中 尚未设置待办 仓库 外链 0 条 · 0 条待核验":
      - /url: /assets/project/10000000-0000-4000-8000-000000000016
      - strong: 资料 08
      - text: 使用中
      - strong: 尚未设置待办
      - text: 仓库 外链 0 条 · 0 条待核验
    - link "资料 09 其他 未记录购买日期 购入价 未记录金额 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000017
      - strong: 资料 09
      - text: 其他
      - strong: 未记录购买日期
      - text: 购入价 未记录金额 使用中
    - link "资料 10 使用中 资料齐全时，补充说明与期限可直接扫读。 尚未设置待办 仓库 外链 0 条 · 0 条待核验":
      - /url: /assets/project/10000000-0000-4000-8000-000000000018
      - strong: 资料 10
      - text: 使用中
      - paragraph: 资料齐全时，补充说明与期限可直接扫读。
      - strong: 尚未设置待办
      - text: 仓库 外链 0 条 · 0 条待核验
    - link "资料 11 其他 未记录购买日期 购入价 未记录金额 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000019
      - strong: 资料 11
      - text: 其他
      - strong: 未记录购买日期
      - text: 购入价 未记录金额 使用中
    - link "资料 12 使用中 尚未设置待办 仓库 外链 0 条 · 0 条待核验":
      - /url: /assets/project/10000000-0000-4000-8000-000000000020
      - strong: 资料 12
      - text: 使用中
      - strong: 尚未设置待办
      - text: 仓库 外链 0 条 · 0 条待核验
    - link "资料 13 资料齐全时，补充说明与期限可直接扫读。 其他 未记录购买日期 购入价 未记录金额 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000021
      - strong: 资料 13
      - text: 资料齐全时，补充说明与期限可直接扫读。 其他
      - strong: 未记录购买日期
      - text: 购入价 未记录金额 使用中
    - link "资料 14 使用中 尚未设置待办 仓库 外链 0 条 · 0 条待核验":
      - /url: /assets/project/10000000-0000-4000-8000-000000000022
      - strong: 资料 14
      - text: 使用中
      - strong: 尚未设置待办
      - text: 仓库 外链 0 条 · 0 条待核验
    - link "资料 15 其他 未记录购买日期 购入价 未记录金额 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000023
      - strong: 资料 15
      - text: 其他
      - strong: 未记录购买日期
      - text: 购入价 未记录金额 使用中
    - link "资料 16 使用中 资料齐全时，补充说明与期限可直接扫读。 尚未设置待办 仓库 外链 0 条 · 0 条待核验":
      - /url: /assets/project/10000000-0000-4000-8000-000000000024
      - strong: 资料 16
      - text: 使用中
      - paragraph: 资料齐全时，补充说明与期限可直接扫读。
      - strong: 尚未设置待办
      - text: 仓库 外链 0 条 · 0 条待核验
    - link "资料 17 其他 未记录购买日期 购入价 未记录金额 使用中":
      - /url: /assets/item/10000000-0000-4000-8000-000000000025
      - strong: 资料 17
      - text: 其他
      - strong: 未记录购买日期
      - text: 购入价 未记录金额 使用中
    - 'link "studio.example.test 域名 · 松果创作工作室 剩余 48 天 到期日: 2026年12月15日 年费 ¥120.00 Synthetic registrar 管理域名 ↗"':
      - /url: /assets/project/10000000-0000-4000-8000-000000000001#project-domain-e9d4b057-a87c-4813-92c7-eacb0f528512
      - strong: studio.example.test
      - text: 域名 · 松果创作工作室
      - strong: 剩余 48 天
      - text: "到期日: 2026年12月15日 年费"
      - strong: ¥120.00
      - text: Synthetic registrar 管理域名 ↗
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
  38  | 			const cards = page.locator(".workspace-asset-grid > a");
  39  | 			await expect(cards).toHaveCount(25); // 24 assets in the catalog plus the recorded domain.
  40  | 			await expect(page.locator(".workspace-asset-grid")).toHaveClass(
  41  | 				/asset-dense-list/,
  42  | 			);
  43  | 			if (width >= 1280) {
> 44  | 				await expect(page.locator(".asset-project-foot .chip").first()).toBeVisible();
      |                                                                     ^ Error: expect(locator).toBeVisible() failed
  45  | 				const statusX = await page.evaluate(() => [".asset-project-foot .chip", ".asset-library-foot .chip"].map((selector) => document.querySelector(selector)!.getBoundingClientRect().x));
  46  | 				expect(Math.abs(statusX[0] - statusX[1])).toBeLessThanOrEqual(1);
  47  | 			}
  48  | 			expect(
  49  | 				await cards.evaluateAll((cards) =>
  50  | 					cards.every((card) => card.getBoundingClientRect().height < 195),
  51  | 				),
  52  | 			).toBe(true);
  53  | 			await page.screenshot({
  54  | 				path: join(evidence, `dense-list-${language}-${width}.png`),
  55  | 				fullPage: true,
  56  | 			});
  57  | 			await page
  58  | 				.getByRole("button", { name: t("assetCardView"), exact: true })
  59  | 				.click();
  60  | 			const rectangles = await cards.evaluateAll((cards) =>
  61  | 				cards.map((card) => ({
  62  | 					width: card.getBoundingClientRect().width,
  63  | 					height: card.getBoundingClientRect().height,
  64  | 				})),
  65  | 			);
  66  | 			expect(
  67  | 				rectangles.every((rect) => rect.width <= 361 && rect.height < 440),
  68  | 			).toBe(true);
  69  | 			await expect(page.locator(".asset-kind-icon img")).toHaveJSProperty(
  70  | 				"naturalWidth",
  71  | 				640,
  72  | 			);
  73  | 			await expect(page.locator(".asset-project-cover")).toHaveCount(0);
  74  | 			if (width >= 1280)
  75  | 				expect(
  76  | 					await cards.evaluateAll(
  77  | 						(cards) =>
  78  | 							cards.filter(
  79  | 								(card) => card.getBoundingClientRect().bottom <= innerHeight,
  80  | 							).length,
  81  | 					),
  82  | 				).toBeGreaterThanOrEqual(6);
  83  | 			await page.screenshot({
  84  | 				path: join(evidence, `dense-assets-${language}-${width}.png`),
  85  | 				fullPage: true,
  86  | 			});
  87  | 			await page
  88  | 				.getByRole("button", { name: t("assetListView"), exact: true })
  89  | 				.click();
  90  | 			for (const path of [
  91  | 				"/assets",
  92  | 				"/assets/project",
  93  | 				"/assets/item",
  94  | 				"/assets/domains",
  95  | 				"/assets/subscription",
  96  | 				"/finance",
  97  | 				"/accounts",
  98  | 				"/assets/vault#vault-references",
  99  | 			]) {
  100 | 				await page.goto(path);
  101 | 				await expect(
  102 | 					page.locator(".workspace-navigation > a[aria-current='page']"),
  103 | 				).toHaveCount(1);
  104 | 				expect(
  105 | 					await page.evaluate(
  106 | 						() => document.documentElement.scrollWidth <= innerWidth + 1,
  107 | 					),
  108 | 				).toBe(true);
  109 | 			}
  110 | 			await page.goto("/collections");
  111 | 			await expect(page.locator(".collections-tile")).toHaveCount(8);
  112 | 			const geometry = await page.evaluate(() => ({
  113 | 				navBottom: document
  114 | 					.querySelector(".collections-organize-nav")!
  115 | 					.getBoundingClientRect().bottom,
  116 | 				rowTop: document
  117 | 					.querySelector(".collections-existing")!
  118 | 					.getBoundingClientRect().top,
  119 | 			}));
  120 | 			expect(geometry.rowTop - geometry.navBottom).toBeLessThanOrEqual(16);
  121 | 			const first = page.locator(".collections-tile").first();
  122 | 			const sameLine = await first.evaluate((row) => {
  123 | 				const icon = row.querySelector("svg")!.getBoundingClientRect();
  124 | 				const title = row.querySelector("a")!.getBoundingClientRect();
  125 | 				return (
  126 | 					Math.abs(icon.y + icon.height / 2 - title.y - title.height / 2) < 2
  127 | 				);
  128 | 			});
  129 | 			expect(sameLine).toBe(true);
  130 | 			await page.screenshot({
  131 | 				path: join(evidence, `dense-collections-${language}-${width}.png`),
  132 | 				fullPage: true,
  133 | 			});
  134 | 			await page.goto("/finance");
  135 | 			await expect(page.locator(".finance-entry-actions .button")).toHaveCount(
  136 | 				8,
  137 | 			);
  138 | 			const financeGeometry = await page
  139 | 				.locator(".finance-entry-actions .button")
  140 | 				.evaluateAll((buttons) =>
  141 | 					buttons.map((button) => {
  142 | 						const rect = button.getBoundingClientRect();
  143 | 						return {
  144 | 							width: rect.width,
```