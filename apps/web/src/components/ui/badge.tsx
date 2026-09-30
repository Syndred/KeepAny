import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import "./badge.css";

const badgeStyles = cva("badge", {
	variants: {
		tone: {
			neutral: "badge-neutral",
			pending: "badge-pending",
			success: "badge-success",
			warning: "badge-warning",
			muted: "badge-muted",
		},
	},
	defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles>) {
	return <span className={clsx(badgeStyles({ tone }), className)} {...props} />;
}
