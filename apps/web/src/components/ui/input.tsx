import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Shared shadcn-style field; native form semantics are provided by Base UI. */
export function Input({
	className,
	...props
}: ComponentProps<typeof InputPrimitive>) {
	return (
		<InputPrimitive
			data-slot="input"
			{...props}
			className={cn(
				"ui-input min-w-0 rounded-lg border bg-background text-foreground outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
				typeof className === "string" ? className : undefined,
			)}
		/>
	);
}
