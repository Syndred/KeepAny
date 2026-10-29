import { Children, type AnchorHTMLAttributes, type ReactElement } from "react";
import { useRender } from "@base-ui/react/use-render";
import { clsx } from "clsx";
import "./text-link.css";

export function TextLink({
	asChild = false,
	className,
	children,
	...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { asChild?: boolean }) {
	return useRender({
		defaultTagName: "a",
		render: asChild ? (Children.only(children) as ReactElement) : undefined,
		props: {
			...props,
			className: clsx("text-link", className),
			...(asChild ? {} : { children }),
		},
	});
}
