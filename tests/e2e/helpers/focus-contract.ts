import { expect, type Locator } from "@playwright/test";

// 3e754179: ink replaces low-contrast yellow for the keyboard focus outline.
// Assert the visible ring and actual contrast, not merely its design-token name.
export async function expectKeyboardFocusRing(control: Locator) {
	await expect(control).toBeFocused();
	await expect(control).toHaveCSS("outline-style", "solid");
	await expect(control).toHaveCSS("outline-width", "3px");
	await expect(control).toHaveCSS("outline-color", "rgb(23, 36, 58)");
	const contrast = await control.evaluate((element) => {
		const ring = getComputedStyle(element).outlineColor;
		let parent: Element | null = element.parentElement;
		let background = "rgba(0, 0, 0, 0)";
		while (parent) {
			background = getComputedStyle(parent).backgroundColor;
			if (background !== "rgba(0, 0, 0, 0)") break;
			parent = parent.parentElement;
		}
		const luminance = (color: string) => {
			const channels = color.match(/[\d.]+/g)?.map(Number);
			if (
				!channels ||
				channels.length < 3 ||
				(channels.length > 3 && channels[3] !== 1)
			)
				throw Error("focus-background-not-opaque");
			const rgb = channels.slice(0, 3).map((channel) => {
				const v = channel / 255;
				return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
			});
			return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
		};
		const a = luminance(ring),
			b = luminance(background);
		return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
	});
	expect(
		contrast,
		"Keyboard focus ring contrasts with its rendered surroundings",
	).toBeGreaterThanOrEqual(3);
}
