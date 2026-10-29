import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			{...props}
			className={cn(
				"ui-input min-w-0 rounded-lg border bg-background text-foreground outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
				className,
			)}
		/>
	);
}
