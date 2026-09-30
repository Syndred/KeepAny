import { expect, type Locator } from "@playwright/test";

export type SelectChoice = string | { label: string } | { value: string };

function quoteAttributeValue(value: string) {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\A ");
}

export async function selectChoice(locator: Locator, choice: SelectChoice) {
	const triggerId = await locator.getAttribute("id");
	await locator.click();

	const page = locator.page();
	const isLabelChoice = typeof choice !== "string" && "label" in choice;
	const expectedValue =
		typeof choice === "string"
			? choice
			: "value" in choice
				? choice.value
				: undefined;
	let option: Locator;
	if (isLabelChoice)
		option = page.getByRole("option", { name: choice.label, exact: true });
	else {
		if (expectedValue === undefined)
			throw new Error("Select choice is missing its value");
		option = page
			.getByRole("option")
			.and(
				page.locator(
					`[role="option"][data-value="${quoteAttributeValue(expectedValue)}"]`,
				),
			);
	}
	await expect(option).toHaveCount(1);
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
}
