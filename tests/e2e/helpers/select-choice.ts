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
	// Keyboard opening avoids Radix's opening-pointerup guard; selection still exercises the mouse.
	await locator.press("ArrowDown");

	const page = locator.page();
	const popup = page.getByRole("listbox");
	await expect(popup).toBeVisible();
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
	await option.click();
	const trigger = triggerId
		? page.locator(`[id="${quoteAttributeValue(triggerId)}"]`)
		: locator;
	await expect(trigger).toHaveAttribute("data-value", selectedValue);
	await expect(trigger).toHaveAttribute("data-state", "closed");
	await expect(popup).toBeHidden();
}
