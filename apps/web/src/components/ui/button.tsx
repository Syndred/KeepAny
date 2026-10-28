// Adapted from shadcn/ui Base UI; legal/third-party/shadcn-ui/SOURCE.json.
import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
const styles = cva(
	"button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border-2 font-semibold outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
	{
		variants: {
			variant: {
				default: "",
				primary: "primary",
				ghost: "ghost",
				danger: "danger",
			},
			size: { default: "", icon: "icon", small: "small" },
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);
export function Button({
	className,
	variant,
	size,
	asChild = false,
	children,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
	VariantProps<typeof styles> & { asChild?: boolean }) {
	const classes = cn(styles({ variant, size }), className);
	// Navigation and downloads retain native link semantics and keyboard behavior.
	const renderedLink = useRender({
		enabled: asChild,
		defaultTagName: "a",
		render: asChild
			? (React.Children.only(children) as React.ReactElement)
			: undefined,
		props: {
			...props,
			className: classes,
			"data-slot": "button",
			...(props.disabled
				? {
						"aria-disabled": true,
						tabIndex: -1,
						onClick: (event: React.MouseEvent) => event.preventDefault(),
					}
				: {}),
		},
	});
	if (asChild) return renderedLink;
	return (
		<ButtonPrimitive data-slot="button" className={classes} {...props}>
			{children}
		</ButtonPrimitive>
	);
}
