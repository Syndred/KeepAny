# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-density.regression-1.spec.ts >> zh-CN 390px dense records and complete date interaction
- Location: tests\e2e\ui-density.regression-1.spec.ts:19:3

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 44
Received:    36
```

# Page snapshot

```yaml
- generic [ref=f10e3]:
  - complementary [ref=f10e4]:
    - generic [ref=f10e5]:
      - generic [aria-hidden] [ref=f10e6]: K
      - generic [ref=f10e7]:
        - strong [ref=f10e8]: KeepAny
        - generic [ref=f10e9]: 个人资产工作台
      - button "关闭" [ref=f10e10] [cursor=pointer]
    - button [ref=f10e14] [cursor=pointer]:
      - strong [ref=f10e19]: 个人工作区
    - generic [ref=f10e22]: 工作空间
    - navigation "导航" [ref=f10e23]:
      - generic [ref=f10e24]:
        - button "概览 按住拖动排序" [ref=f10e25]
        - link "概览" [ref=f10e33] [cursor=pointer]:
          - /url: /
      - generic [ref=f10e40]:
        - button "待办 按住拖动排序" [ref=f10e41]
        - link "待办 5" [ref=f10e49] [cursor=pointer]:
          - /url: /tasks
          - generic [ref=f10e53]: 待办
          - generic [ref=f10e54]: "5"
      - generic [ref=f10e55]:
        - button "资产 按住拖动排序" [ref=f10e56]
        - link "资产" [ref=f10e64] [cursor=pointer]:
          - /url: /assets
      - generic [ref=f10e70]:
        - button "账号 按住拖动排序" [ref=f10e71]
        - link "账号" [ref=f10e79] [cursor=pointer]:
          - /url: /accounts
      - status [ref=f10e84]
    - link "回收站" [ref=f10e85] [cursor=pointer]:
      - /url: /trash
    - generic [ref=f10e89]:
      - generic [ref=f10e90]: 我的分类
      - link "工作分类 1" [ref=f10e91] [cursor=pointer]:
        - /url: /collections/895c21e4-c658-42a8-959c-694cee8a4260
      - link "工作分类 2" [ref=f10e93] [cursor=pointer]:
        - /url: /collections/3fbafce2-5d73-4a76-912d-07f641fe9acd
      - link "工作分类 3" [ref=f10e95] [cursor=pointer]:
        - /url: /collections/58b57721-dbfb-4a3c-9350-723831c17391
      - link "工作分类 4" [ref=f10e97] [cursor=pointer]:
        - /url: /collections/0617c858-f37b-4101-817a-e88d4e57b39d
      - link "工作分类 5" [ref=f10e99] [cursor=pointer]:
        - /url: /collections/772b8145-ab53-405b-9246-1ce57af2908e
      - link "工作分类 6" [ref=f10e101] [cursor=pointer]:
        - /url: /collections/cf3fe7b0-b07d-45a4-92c4-b2b47add87e2
      - link "工作分类 7" [ref=f10e103] [cursor=pointer]:
        - /url: /collections/0050ebfd-6a0b-4589-bc14-6367f8ac2907
      - link "工作分类 8" [ref=f10e105] [cursor=pointer]:
        - /url: /collections/1176d5f7-e9b7-43f7-ae05-1b0d9ad03a41
      - link "自定义侧边栏" [ref=f10e107] [cursor=pointer]:
        - /url: /collections
    - button "我 我的工作区 仅自己可见" [ref=f10e110] [cursor=pointer]:
      - generic [ref=f10e111]: 我
      - generic [ref=f10e112]:
        - strong [ref=f10e113]: 我的工作区
        - generic [ref=f10e114]: 仅自己可见
  - generic [ref=f10e117]:
    - banner [ref=f10e118]:
      - button "导航" [ref=f10e119] [cursor=pointer]
      - link "返回概览" [ref=f10e121] [cursor=pointer]:
        - /url: /
      - button "搜索全部资料" [ref=f10e124] [cursor=pointer]
      - generic [ref=f10e128]:
        - link "待办提醒" [ref=f10e129] [cursor=pointer]:
          - /url: /tasks
        - button "AI 助手与授权" [ref=f10e134] [cursor=pointer]
        - link "收录与备份" [ref=f10e138] [cursor=pointer]:
          - /url: /intake
    - main [ref=f10e140]:
      - generic [ref=f10e141]:
        - generic [ref=f10e142]:
          - heading "自定义侧边栏" [level=1] [ref=f10e143]
          - paragraph [ref=f10e144]: 调整常用入口，或把不同类型的资产放进同一个分类。
        - button "新建分类" [disabled] [ref=f10e146]
      - generic [ref=f10e148]:
        - region "侧边栏入口" [ref=f10e149]:
          - generic [ref=f10e151]:
            - heading "侧边栏入口" [level=2] [ref=f10e152]
            - paragraph [ref=f10e153]: 拖动手柄排序，也可使用上下方向键。
          - generic [ref=f10e154]:
            - generic [ref=f10e155]:
              - button "概览 按住拖动排序" [ref=f10e156]
              - link "概览" [ref=f10e164] [cursor=pointer]:
                - /url: /
              - 'checkbox "显示侧栏入口: 概览" [checked] [disabled] [ref=f10e171]'
              - generic [ref=f10e172]:
                - button "上移 概览" [disabled] [ref=f10e173]
                - button "下移 概览" [ref=f10e176] [cursor=pointer]
            - generic [ref=f10e179]:
              - button "待办 按住拖动排序" [ref=f10e180]
              - link "待办" [ref=f10e188] [cursor=pointer]:
                - /url: /tasks
              - 'checkbox "显示侧栏入口: 待办" [checked] [ref=f10e193] [cursor=pointer]'
              - generic [ref=f10e194]:
                - button "上移 待办" [ref=f10e195] [cursor=pointer]
                - button "下移 待办" [ref=f10e198] [cursor=pointer]
            - generic [ref=f10e201]:
              - button "资产 按住拖动排序" [ref=f10e202]
              - link "资产" [ref=f10e210] [cursor=pointer]:
                - /url: /assets
              - 'checkbox "显示侧栏入口: 资产" [checked] [ref=f10e216] [cursor=pointer]'
              - generic [ref=f10e217]:
                - button "上移 资产" [ref=f10e218] [cursor=pointer]
                - button "下移 资产" [ref=f10e221] [cursor=pointer]
            - generic [ref=f10e224]:
              - button "账号 按住拖动排序" [ref=f10e225]
              - link "账号" [ref=f10e233] [cursor=pointer]:
                - /url: /accounts
              - 'checkbox "显示侧栏入口: 账号" [checked] [ref=f10e238] [cursor=pointer]'
              - generic [ref=f10e239]:
                - button "上移 账号" [ref=f10e240] [cursor=pointer]
                - button "下移 账号" [disabled] [ref=f10e243]
            - status [ref=f10e246]
        - region "我的分类" [ref=f10e247]:
          - article [ref=f10e248]:
            - link [ref=f10e251] [cursor=pointer]:
              - /url: /collections/895c21e4-c658-42a8-959c-694cee8a4260
              - strong [ref=f10e252]: 工作分类 1
            - generic [ref=f10e253]: 5 项资产
            - button "更多操作" [ref=f10e255] [cursor=pointer]
          - article [ref=f10e260]:
            - link [ref=f10e263] [cursor=pointer]:
              - /url: /collections/3fbafce2-5d73-4a76-912d-07f641fe9acd
              - strong [ref=f10e264]: 工作分类 2
            - generic [ref=f10e265]: 5 项资产
            - button "更多操作" [ref=f10e267] [cursor=pointer]
          - article [ref=f10e272]:
            - link [ref=f10e275] [cursor=pointer]:
              - /url: /collections/58b57721-dbfb-4a3c-9350-723831c17391
              - strong [ref=f10e276]: 工作分类 3
            - generic [ref=f10e277]: 5 项资产
            - button "更多操作" [ref=f10e279] [cursor=pointer]
          - article [ref=f10e284]:
            - link [ref=f10e287] [cursor=pointer]:
              - /url: /collections/0617c858-f37b-4101-817a-e88d4e57b39d
              - strong [ref=f10e288]: 工作分类 4
            - generic [ref=f10e289]: 5 项资产
            - button "更多操作" [ref=f10e291] [cursor=pointer]
          - article [ref=f10e296]:
            - link [ref=f10e299] [cursor=pointer]:
              - /url: /collections/772b8145-ab53-405b-9246-1ce57af2908e
              - strong [ref=f10e300]: 工作分类 5
            - generic [ref=f10e301]: 5 项资产
            - button "更多操作" [ref=f10e303] [cursor=pointer]
          - article [ref=f10e308]:
            - link [ref=f10e311] [cursor=pointer]:
              - /url: /collections/cf3fe7b0-b07d-45a4-92c4-b2b47add87e2
              - strong [ref=f10e312]: 工作分类 6
            - generic [ref=f10e313]: 5 项资产
            - button "更多操作" [ref=f10e315] [cursor=pointer]
          - article [ref=f10e320]:
            - link [ref=f10e323] [cursor=pointer]:
              - /url: /collections/0050ebfd-6a0b-4589-bc14-6367f8ac2907
              - strong [ref=f10e324]: 工作分类 7
            - generic [ref=f10e325]: 5 项资产
            - button "更多操作" [ref=f10e327] [cursor=pointer]
          - article [ref=f10e332]:
            - link [ref=f10e335] [cursor=pointer]:
              - /url: /collections/1176d5f7-e9b7-43f7-ae05-1b0d9ad03a41
              - strong [ref=f10e336]: 工作分类 8
            - generic [ref=f10e337]: 5 项资产
            - button "更多操作" [ref=f10e339] [cursor=pointer]
      - region "新建分类" [ref=f10e344]:
        - generic [ref=f10e345]:
          - heading "新建分类" [level=2] [ref=f10e347]
          - generic [ref=f10e348]:
            - generic [ref=f10e349]: 分类名称
            - textbox "分类名称" [ref=f10e350]:
              - /placeholder: 例如：创作工作室
          - group "加入哪些资产" [ref=f10e351]:
            - generic [ref=f10e353]:
              - generic [ref=f10e354]: 搜索资产
              - textbox "搜索资产" [ref=f10e355]
            - generic [ref=f10e356]:
              - generic [ref=f10e357]:
                - heading "项目" [level=3] [ref=f10e358]
                - generic [ref=f10e359] [cursor=pointer]:
                  - checkbox "旅行清单" [ref=f10e360]
                  - generic [ref=f10e361]: 旅行清单
                - generic [ref=f10e362] [cursor=pointer]:
                  - checkbox "松果创作工作室" [ref=f10e363]
                  - generic [ref=f10e364]: 松果创作工作室
                - generic [ref=f10e365] [cursor=pointer]:
                  - checkbox "资料 02" [ref=f10e366]
                  - generic [ref=f10e367]: 资料 02
                - generic [ref=f10e368] [cursor=pointer]:
                  - checkbox "资料 04" [ref=f10e369]
                  - generic [ref=f10e370]: 资料 04
                - generic [ref=f10e371] [cursor=pointer]:
                  - checkbox "资料 06" [ref=f10e372]
                  - generic [ref=f10e373]: 资料 06
                - generic [ref=f10e374] [cursor=pointer]:
                  - checkbox "资料 08" [ref=f10e375]
                  - generic [ref=f10e376]: 资料 08
                - generic [ref=f10e377] [cursor=pointer]:
                  - checkbox "资料 10" [ref=f10e378]
                  - generic [ref=f10e379]: 资料 10
                - generic [ref=f10e380] [cursor=pointer]:
                  - checkbox "资料 12" [ref=f10e381]
                  - generic [ref=f10e382]: 资料 12
                - generic [ref=f10e383] [cursor=pointer]:
                  - checkbox "资料 14" [ref=f10e384]
                  - generic [ref=f10e385]: 资料 14
                - generic [ref=f10e386] [cursor=pointer]:
                  - checkbox "资料 16" [ref=f10e387]
                  - generic [ref=f10e388]: 资料 16
              - generic [ref=f10e389]:
                - heading "账号" [level=3] [ref=f10e390]
                - generic [ref=f10e391] [cursor=pointer]:
                  - checkbox "工作室邮箱" [ref=f10e392]
                  - generic [ref=f10e393]: 工作室邮箱
              - generic [ref=f10e394]:
                - heading "订阅" [level=3] [ref=f10e395]
                - generic [ref=f10e396] [cursor=pointer]:
                  - checkbox "CloudNest 云主机" [ref=f10e397]
                  - generic [ref=f10e398]: CloudNest 云主机
                - generic [ref=f10e399] [cursor=pointer]:
                  - checkbox "音乐会员" [ref=f10e400]
                  - generic [ref=f10e401]: 音乐会员
              - generic [ref=f10e402]:
                - heading "实物" [level=3] [ref=f10e403]
                - generic [ref=f10e404] [cursor=pointer]:
                  - checkbox "多机位外拍套装与备用收音设备的长期借用登记" [ref=f10e405]
                  - generic [ref=f10e406]: 多机位外拍套装与备用收音设备的长期借用登记
                - generic [ref=f10e407] [cursor=pointer]:
                  - checkbox "工作室笔记本 · Pro 16" [ref=f10e408]
                  - generic [ref=f10e409]: 工作室笔记本 · Pro 16
                - generic [ref=f10e410] [cursor=pointer]:
                  - checkbox "资料 01" [ref=f10e411]
                  - generic [ref=f10e412]: 资料 01
                - generic [ref=f10e413] [cursor=pointer]:
                  - checkbox "资料 03" [ref=f10e414]
                  - generic [ref=f10e415]: 资料 03
                - generic [ref=f10e416] [cursor=pointer]:
                  - checkbox "资料 05" [ref=f10e417]
                  - generic [ref=f10e418]: 资料 05
                - generic [ref=f10e419] [cursor=pointer]:
                  - checkbox "资料 07" [ref=f10e420]
                  - generic [ref=f10e421]: 资料 07
                - generic [ref=f10e422] [cursor=pointer]:
                  - checkbox "资料 09" [ref=f10e423]
                  - generic [ref=f10e424]: 资料 09
                - generic [ref=f10e425] [cursor=pointer]:
                  - checkbox "资料 11" [ref=f10e426]
                  - generic [ref=f10e427]: 资料 11
                - generic [ref=f10e428] [cursor=pointer]:
                  - checkbox "资料 13" [ref=f10e429]
                  - generic [ref=f10e430]: 资料 13
                - generic [ref=f10e431] [cursor=pointer]:
                  - checkbox "资料 15" [ref=f10e432]
                  - generic [ref=f10e433]: 资料 15
                - generic [ref=f10e434] [cursor=pointer]:
                  - checkbox "资料 17" [ref=f10e435]
                  - generic [ref=f10e436]: 资料 17
                - generic [ref=f10e437] [cursor=pointer]:
                  - checkbox "随身背包" [ref=f10e438]
                  - generic [ref=f10e439]: 随身背包
          - generic [ref=f10e440]:
            - button "保存分类" [ref=f10e441] [cursor=pointer]
            - button "取消" [ref=f10e442] [cursor=pointer]
            - button "新建另一个" [ref=f10e443] [cursor=pointer]
```

# Test source

```ts
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
  44  | 				await expect(
  45  | 					page.locator(".asset-project-foot .chip").first(),
  46  | 				).toBeVisible();
  47  | 				const statusX = await page.evaluate(() =>
  48  | 					[".asset-project-foot .chip", ".asset-library-foot .chip"].map(
  49  | 						(selector) =>
  50  | 							document.querySelector(selector)!.getBoundingClientRect().x,
  51  | 					),
  52  | 				);
  53  | 				expect(Math.abs(statusX[0] - statusX[1])).toBeLessThanOrEqual(1);
  54  | 			}
  55  | 			expect(
  56  | 				await cards.evaluateAll((cards) =>
  57  | 					cards.every((card) => card.getBoundingClientRect().height < 195),
  58  | 				),
  59  | 			).toBe(true);
  60  | 			await page.screenshot({
  61  | 				path: join(evidence, `dense-list-${language}-${width}.png`),
  62  | 				fullPage: true,
  63  | 			});
  64  | 			await page
  65  | 				.getByRole("button", { name: t("assetCardView"), exact: true })
  66  | 				.click();
  67  | 			const rectangles = await cards.evaluateAll((cards) =>
  68  | 				cards.map((card) => ({
  69  | 					width: card.getBoundingClientRect().width,
  70  | 					height: card.getBoundingClientRect().height,
  71  | 					top: card.getBoundingClientRect().top,
  72  | 					bottom: card.getBoundingClientRect().bottom,
  73  | 				})),
  74  | 			);
  75  | 			expect(
  76  | 				rectangles.every((rect) => rect.width <= 361 && rect.height < 440),
  77  | 			).toBe(true);
  78  | 			for (const rect of rectangles) {
  79  | 				const sameRow = rectangles.filter((other) => Math.abs(other.top - rect.top) < 1);
  80  | 				expect(Math.max(...sameRow.map((other) => other.bottom)) - Math.min(...sameRow.map((other) => other.bottom))).toBeLessThanOrEqual(1);
  81  | 			}
  82  | 			await expect(page.locator(".asset-kind-icon img")).toHaveJSProperty(
  83  | 				"naturalWidth",
  84  | 				640,
  85  | 			);
  86  | 			await expect(page.locator(".asset-project-cover")).toHaveCount(0);
  87  | 			if (width >= 1280)
  88  | 				expect(
  89  | 					await cards.evaluateAll(
  90  | 						(cards) =>
  91  | 							cards.filter(
  92  | 								(card) => card.getBoundingClientRect().bottom <= innerHeight,
  93  | 							).length,
  94  | 					),
  95  | 				).toBeGreaterThanOrEqual(6);
  96  | 			await page.screenshot({
  97  | 				path: join(evidence, `dense-assets-${language}-${width}.png`),
  98  | 				fullPage: true,
  99  | 			});
  100 | 			await page
  101 | 				.getByRole("button", { name: t("assetListView"), exact: true })
  102 | 				.click();
  103 | 			for (const path of [
  104 | 				"/assets",
  105 | 				"/assets/project",
  106 | 				"/assets/item",
  107 | 				"/assets/domains",
  108 | 				"/assets/subscription",
  109 | 				"/finance",
  110 | 				"/accounts",
  111 | 				"/assets/vault#vault-references",
  112 | 			]) {
  113 | 				await page.goto(path);
  114 | 				await expect(
  115 | 					page.locator(".workspace-navigation > a[aria-current='page']"),
  116 | 				).toHaveCount(1);
  117 | 				expect(
  118 | 					await page.evaluate(
  119 | 						() => document.documentElement.scrollWidth <= innerWidth + 1,
  120 | 					),
  121 | 				).toBe(true);
  122 | 			}
  123 | 			await page.goto("/collections");
  124 | 			await expect(page.locator(".collections-tile")).toHaveCount(8);
  125 | 			if (width <= 680) {
  126 | 				const target = await page.locator(".collections-tile button[aria-haspopup=menu]").first().boundingBox();
> 127 | 				expect(target!.width).toBeGreaterThanOrEqual(44);
      |                           ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  128 | 				expect(target!.height).toBeGreaterThanOrEqual(44);
  129 | 			}
  130 | 			const geometry = await page.evaluate(() => ({
  131 | 				navBottom: document
  132 | 					.querySelector(".collections-organize-nav")!
  133 | 					.getBoundingClientRect().bottom,
  134 | 				rowTop: document
  135 | 					.querySelector(".collections-existing")!
  136 | 					.getBoundingClientRect().top,
  137 | 			}));
  138 | 			expect(geometry.rowTop - geometry.navBottom).toBeLessThanOrEqual(16);
  139 | 			const first = page.locator(".collections-tile").first();
  140 | 			const sameLine = await first.evaluate((row) => {
  141 | 				const icon = row.querySelector("svg")!.getBoundingClientRect();
  142 | 				const title = row.querySelector("a")!.getBoundingClientRect();
  143 | 				return (
  144 | 					Math.abs(icon.y + icon.height / 2 - title.y - title.height / 2) < 2
  145 | 				);
  146 | 			});
  147 | 			expect(sameLine).toBe(true);
  148 | 			await page.screenshot({
  149 | 				path: join(evidence, `dense-collections-${language}-${width}.png`),
  150 | 				fullPage: true,
  151 | 			});
  152 | 			await page.goto("/finance");
  153 | 			await expect(page.locator(".finance-entry-actions .button")).toHaveCount(
  154 | 				8,
  155 | 			);
  156 | 			const financeGeometry = await page
  157 | 				.locator(".finance-entry-actions .button")
  158 | 				.evaluateAll((buttons) =>
  159 | 					buttons.map((button) => {
  160 | 						const rect = button.getBoundingClientRect();
  161 | 						return {
  162 | 							width: rect.width,
  163 | 							height: rect.height,
  164 | 							radius: parseFloat(getComputedStyle(button).borderRadius),
  165 | 						};
  166 | 					}),
  167 | 				);
  168 | 			expect(financeGeometry.length).toBe(8);
  169 | 			expect(
  170 | 				financeGeometry.every(
  171 | 					(rect) => rect.width > rect.height * 1.25 && rect.radius > 100,
  172 | 				),
  173 | 			).toBe(true);
  174 | 			await page.screenshot({
  175 | 				path: join(evidence, `dense-finance-${language}-${width}.png`),
  176 | 				fullPage: true,
  177 | 			});
  178 | 			await page.goto("/tasks");
  179 | 			await expect(page.locator(".tasks-plan-card")).toHaveCount(0);
  180 | 			await expect(page.locator(".tasks-columns")).toHaveClass(/is-single/);
  181 | 			await expect(page.locator(".task-filters button").first()).toContainText(
  182 | 				t("all"),
  183 | 			);
  184 | 			const from = page.locator("#task-date-from");
  185 | 			await from.fill("2026-02-30");
  186 | 			expect(
  187 | 				await from.evaluate((input: HTMLInputElement) => input.checkValidity()),
  188 | 			).toBe(false);
  189 | 			await from.fill("");
  190 | 			expect(
  191 | 				await from.evaluate((input: HTMLInputElement) => input.checkValidity()),
  192 | 			).toBe(true);
  193 | 			await from.click({ position: { x: 12, y: 15 } });
  194 | 			await expect(page.locator(".date-popover")).toBeVisible();
  195 | 			const bounds = await page.locator(".date-popover").boundingBox();
  196 | 			expect(bounds!.x).toBeGreaterThanOrEqual(0);
  197 | 			expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  198 | 			if (width <= 760) {
  199 | 				const targets = await page.locator(".rdp-day_button, .rdp-button_previous, .rdp-button_next").evaluateAll((buttons) => buttons.map((button) => ({width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height})));
  200 | 				expect(targets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
  201 | 			}
  202 | 			await page.screenshot({
  203 | 				path: join(evidence, `dense-date-${language}-${width}.png`),
  204 | 				fullPage: true,
  205 | 			});
  206 | 			await page.locator('.rdp-day[data-day="2026-10-29"] button').click();
  207 | 			await expect(from).toHaveValue("2026-10-29");
  208 | 			await expect(page.locator(".date-popover")).toBeHidden();
  209 | 			await expect(from).toBeFocused();
  210 | 			await from.press("ArrowDown");
  211 | 			await expect(page.locator(".date-popover")).toBeVisible();
  212 | 			await expect
  213 | 				.poll(() =>
  214 | 					page
  215 | 						.locator(".date-popover")
  216 | 						.evaluate((popup) => popup.contains(document.activeElement)),
  217 | 				)
  218 | 				.toBe(true);
  219 | 			await page.keyboard.press("Escape");
  220 | 			await expect(page.locator(".date-popover")).toBeHidden();
  221 | 			await page
  222 | 				.getByRole("button", { name: t("taskClearDates"), exact: true })
  223 | 				.click();
  224 | 			await expect(from).toHaveValue("");
  225 | 			const rowDate = page.locator(`#task-${ids.task} .date-field input`);
  226 | 			await rowDate.fill("2026-11-09");
  227 | 			await expect(
```