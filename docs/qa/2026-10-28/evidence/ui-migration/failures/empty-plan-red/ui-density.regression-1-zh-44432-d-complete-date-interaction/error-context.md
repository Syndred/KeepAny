# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-density.regression-1.spec.ts >> zh-CN 1280px dense records and complete date interaction
- Location: tests\e2e\ui-density.regression-1.spec.ts:19:3

# Error details

```
Error: expect(locator).toHaveClass(expected) failed

Locator: locator('.tasks-columns')
Expected pattern: /is-single/
Received string:  "tasks-columns"
Timeout: 5000ms

Call log:
  - Expect "toHaveClass" locator('.tasks-columns') with timeout 5000ms
  - waiting for locator('.tasks-columns')
    11 × locator resolved to <div class="tasks-columns">…</div>
       - unexpected value "tasks-columns"

```

```yaml
- region "近期任务":
  - heading "近期任务" [level=2]
  - text: "6"
  - article
  - article
  - article
  - article
  - article
  - article
- region "计划详情":
  - heading "计划详情" [level=2]
  - strong: 这里还没有内容
```

# Test source

```ts
  69  | 					width: card.getBoundingClientRect().width,
  70  | 					height: card.getBoundingClientRect().height,
  71  | 				})),
  72  | 			);
  73  | 			expect(
  74  | 				rectangles.every((rect) => rect.width <= 361 && rect.height < 440),
  75  | 			).toBe(true);
  76  | 			await expect(page.locator(".asset-kind-icon img")).toHaveJSProperty(
  77  | 				"naturalWidth",
  78  | 				640,
  79  | 			);
  80  | 			await expect(page.locator(".asset-project-cover")).toHaveCount(0);
  81  | 			if (width >= 1280)
  82  | 				expect(
  83  | 					await cards.evaluateAll(
  84  | 						(cards) =>
  85  | 							cards.filter(
  86  | 								(card) => card.getBoundingClientRect().bottom <= innerHeight,
  87  | 							).length,
  88  | 					),
  89  | 				).toBeGreaterThanOrEqual(6);
  90  | 			await page.screenshot({
  91  | 				path: join(evidence, `dense-assets-${language}-${width}.png`),
  92  | 				fullPage: true,
  93  | 			});
  94  | 			await page
  95  | 				.getByRole("button", { name: t("assetListView"), exact: true })
  96  | 				.click();
  97  | 			for (const path of [
  98  | 				"/assets",
  99  | 				"/assets/project",
  100 | 				"/assets/item",
  101 | 				"/assets/domains",
  102 | 				"/assets/subscription",
  103 | 				"/finance",
  104 | 				"/accounts",
  105 | 				"/assets/vault#vault-references",
  106 | 			]) {
  107 | 				await page.goto(path);
  108 | 				await expect(
  109 | 					page.locator(".workspace-navigation > a[aria-current='page']"),
  110 | 				).toHaveCount(1);
  111 | 				expect(
  112 | 					await page.evaluate(
  113 | 						() => document.documentElement.scrollWidth <= innerWidth + 1,
  114 | 					),
  115 | 				).toBe(true);
  116 | 			}
  117 | 			await page.goto("/collections");
  118 | 			await expect(page.locator(".collections-tile")).toHaveCount(8);
  119 | 			const geometry = await page.evaluate(() => ({
  120 | 				navBottom: document
  121 | 					.querySelector(".collections-organize-nav")!
  122 | 					.getBoundingClientRect().bottom,
  123 | 				rowTop: document
  124 | 					.querySelector(".collections-existing")!
  125 | 					.getBoundingClientRect().top,
  126 | 			}));
  127 | 			expect(geometry.rowTop - geometry.navBottom).toBeLessThanOrEqual(16);
  128 | 			const first = page.locator(".collections-tile").first();
  129 | 			const sameLine = await first.evaluate((row) => {
  130 | 				const icon = row.querySelector("svg")!.getBoundingClientRect();
  131 | 				const title = row.querySelector("a")!.getBoundingClientRect();
  132 | 				return (
  133 | 					Math.abs(icon.y + icon.height / 2 - title.y - title.height / 2) < 2
  134 | 				);
  135 | 			});
  136 | 			expect(sameLine).toBe(true);
  137 | 			await page.screenshot({
  138 | 				path: join(evidence, `dense-collections-${language}-${width}.png`),
  139 | 				fullPage: true,
  140 | 			});
  141 | 			await page.goto("/finance");
  142 | 			await expect(page.locator(".finance-entry-actions .button")).toHaveCount(
  143 | 				8,
  144 | 			);
  145 | 			const financeGeometry = await page
  146 | 				.locator(".finance-entry-actions .button")
  147 | 				.evaluateAll((buttons) =>
  148 | 					buttons.map((button) => {
  149 | 						const rect = button.getBoundingClientRect();
  150 | 						return {
  151 | 							width: rect.width,
  152 | 							height: rect.height,
  153 | 							radius: parseFloat(getComputedStyle(button).borderRadius),
  154 | 						};
  155 | 					}),
  156 | 				);
  157 | 			expect(financeGeometry.length).toBe(8);
  158 | 			expect(
  159 | 				financeGeometry.every(
  160 | 					(rect) => rect.width > rect.height * 1.25 && rect.radius > 100,
  161 | 				),
  162 | 			).toBe(true);
  163 | 			await page.screenshot({
  164 | 				path: join(evidence, `dense-finance-${language}-${width}.png`),
  165 | 				fullPage: true,
  166 | 			});
  167 | 			await page.goto("/tasks");
  168 | 			await expect(page.locator(".tasks-plan-card")).toHaveCount(0);
> 169 | 			await expect(page.locator(".tasks-columns")).toHaveClass(/is-single/);
      |                                                 ^ Error: expect(locator).toHaveClass(expected) failed
  170 | 			await expect(page.locator(".task-filters button").first()).toContainText(
  171 | 				t("all"),
  172 | 			);
  173 | 			const from = page.locator("#task-date-from");
  174 | 			await from.fill("2026-02-30");
  175 | 			expect(
  176 | 				await from.evaluate((input: HTMLInputElement) => input.checkValidity()),
  177 | 			).toBe(false);
  178 | 			await from.fill("");
  179 | 			expect(
  180 | 				await from.evaluate((input: HTMLInputElement) => input.checkValidity()),
  181 | 			).toBe(true);
  182 | 			await from.click({ position: { x: 12, y: 15 } });
  183 | 			await expect(page.locator(".date-popover")).toBeVisible();
  184 | 			const bounds = await page.locator(".date-popover").boundingBox();
  185 | 			expect(bounds!.x).toBeGreaterThanOrEqual(0);
  186 | 			expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  187 | 			await page.screenshot({
  188 | 				path: join(evidence, `dense-date-${language}-${width}.png`),
  189 | 				fullPage: true,
  190 | 			});
  191 | 			await page.locator('.rdp-day[data-day="2026-10-29"] button').click();
  192 | 			await expect(from).toHaveValue("2026-10-29");
  193 | 			await expect(page.locator(".date-popover")).toBeHidden();
  194 | 			await expect(from).toBeFocused();
  195 | 			await from.press("ArrowDown");
  196 | 			await expect(page.locator(".date-popover")).toBeVisible();
  197 | 			await expect
  198 | 				.poll(() =>
  199 | 					page
  200 | 						.locator(".date-popover")
  201 | 						.evaluate((popup) => popup.contains(document.activeElement)),
  202 | 				)
  203 | 				.toBe(true);
  204 | 			await page.keyboard.press("Escape");
  205 | 			await expect(page.locator(".date-popover")).toBeHidden();
  206 | 			await page
  207 | 				.getByRole("button", { name: t("taskClearDates"), exact: true })
  208 | 				.click();
  209 | 			await expect(from).toHaveValue("");
  210 | 			const rowDate = page.locator(`#task-${ids.task} .date-field input`);
  211 | 			await rowDate.fill("2026-11-09");
  212 | 			await expect(
  213 | 				page
  214 | 					.getByRole("status")
  215 | 					.filter({ hasText: t("saved") })
  216 | 					.first(),
  217 | 			).toBeVisible();
  218 | 			await page.reload();
  219 | 			await expect(
  220 | 				page.locator(`#task-${ids.task} .date-field input`),
  221 | 			).toHaveValue("2026-11-09");
  222 | 			if (width <= 760)
  223 | 				await page
  224 | 					.getByRole("button", { name: t("navigation"), exact: true })
  225 | 					.click();
  226 | 			await page.locator(".workspace-current").click();
  227 | 			await expect(page.getByRole("menuitem")).toHaveCount(3);
  228 | 			await page
  229 | 				.getByRole("menuitem", { name: t("settings"), exact: true })
  230 | 				.click();
  231 | 			await expect(page).toHaveURL(/\/settings$/);
  232 | 			expect(errors).toEqual([]);
  233 | 		});
  234 | 	}
  235 | 
```