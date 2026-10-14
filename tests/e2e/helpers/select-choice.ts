import { expect, type Locator } from "@playwright/test";

export type SelectChoice = string | { label: string } | { value: string };

function quoteAttributeValue(value: string) {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\A ");
}

export async function selectChoice(locator: Locator, choice: SelectChoice) {
	await expect(locator).toBeVisible();
	await expect(locator).toBeEnabled();
	const triggerId = await locator.getAttribute("id");
	const page = locator.page();
	const trigger = triggerId
		? page.locator(`[id="${quoteAttributeValue(triggerId)}"]`)
		: locator;
	// Keyboard opening avoids Radix's opening-pointerup guard; selection still exercises the mouse.
	await locator.press("ArrowDown");
	await expect(trigger).toHaveAttribute("data-state", "open");
	// Radix only supplies aria-controls while open and hides the background roles.
	const popupId = await trigger.getAttribute("aria-controls");
	if (!popupId)
		throw new Error("Select trigger is missing its popup relationship");
	const popup = page
		.getByRole("listbox")
		.and(page.locator(`[id="${quoteAttributeValue(popupId)}"]`));
	await expect(popup).toBeVisible();
	// Wait for focus to enter Radix's menu; visibility alone is not readiness.
	await expect
		.poll(() =>
			popup.evaluate((element) =>
				element.contains(element.ownerDocument.activeElement),
			),
		)
		.toBe(true);
	const isLabelChoice = typeof choice !== "string" && "label" in choice;
	const expectedValue =
		typeof choice === "string"
			? choice
			: "value" in choice
				? choice.value
				: undefined;
	let option: Locator;
	if (isLabelChoice)
		option = popup.getByRole("option", { name: choice.label, exact: true });
	else {
		if (expectedValue === undefined)
			throw new Error("Select choice is missing its value");
		option = popup
			.getByRole("option")
			.and(
				page.locator(
					`[role="option"][data-value="${quoteAttributeValue(expectedValue)}"]`,
				),
			);
	}
	await expect(option).toHaveCount(1);
	await expect(option).toBeVisible();
	const selectedValue = isLabelChoice
		? await option.getAttribute("data-value")
		: expectedValue;
	if (selectedValue === null || selectedValue === undefined)
		throw new Error("Select option is missing its data-value");
	// Settle pointer focus/scroll before click calculates its target coordinates.
	await option.hover();
	await option.click();
	await expect(trigger).toHaveAttribute("data-value", selectedValue);
	await expect(trigger).toHaveAttribute("data-state", "closed");
	await expect(popup).toBeHidden();
}
