import type { AnchorHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { clsx } from "clsx";
import "./text-link.css";

export function TextLink({ asChild = false, className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { asChild?: boolean }) {
	const Component = asChild ? Slot : "a";
	return <Component className={clsx("text-link", className)} {...props} />;
}
