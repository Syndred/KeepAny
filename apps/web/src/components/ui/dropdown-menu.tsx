import "./overlays.css";
// shadcn/ui Base UI composition; legal/third-party/shadcn-ui/SOURCE.json.
import { Menu } from "@base-ui/react/menu";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export function DropdownMenuContent({
	children,
	className,
	align = "start",
	side = "bottom",
	...props
}: ComponentProps<typeof Menu.Popup> &
	Pick<ComponentProps<typeof Menu.Positioner>, "align" | "side">) {
	return (
		<Menu.Portal>
			<Menu.Positioner
				side={side}
				align={align}
				sideOffset={6}
				collisionPadding={10}
				className="ui-positioner"
			>
				<Menu.Popup
					{...props}
					data-slot="dropdown-menu-content"
					className={cn("ui-menu", className)}
				>
					{children}
				</Menu.Popup>
			</Menu.Positioner>
		</Menu.Portal>
	);
}
export function DropdownMenuItem({
	className,
	...props
}: ComponentProps<typeof Menu.Item>) {
	return (
		<Menu.Item
			{...props}
			className={cn(
				"ui-menu-item",
				typeof className === "string" ? className : undefined,
			)}
		/>
	);
}
