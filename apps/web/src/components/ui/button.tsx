// shadcn/ui composition pattern; Radix Slot + class-variance-authority (MIT).
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
const styles = cva("button", {
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
});
export function Button({
	className,
	variant,
	size,
	asChild = false,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
	VariantProps<typeof styles> & { asChild?: boolean }) {
	const Component = asChild ? Slot : "button";
	return (
		<Component
			className={clsx(styles({ variant, size }), className)}
			{...props}
		/>
	);
}
