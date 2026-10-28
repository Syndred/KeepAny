import "./overlays.css";
// shadcn/ui Base UI composition; legal/third-party/shadcn-ui/SOURCE.json.
import { Popover as Primitive } from "@base-ui/react/popover";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export function PopoverContent({
	children,
	className,
	align = "start",
	anchor,
	...props
}: ComponentProps<typeof Primitive.Popup> &
	Pick<ComponentProps<typeof Primitive.Positioner>, "align" | "anchor">) {
	return (
		<Primitive.Portal>
			<Primitive.Positioner
				align={align}
				anchor={anchor}
				sideOffset={6}
				collisionPadding={12}
				className="ui-positioner"
			>
				<Primitive.Popup
					data-slot="popover-content"
					className={cn("ui-popover", className)}
					{...props}
				>
					{children}
				</Primitive.Popup>
			</Primitive.Positioner>
		</Primitive.Portal>
	);
}
