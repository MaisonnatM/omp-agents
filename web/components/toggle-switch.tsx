import { Switch } from "@base-ui/react/switch";
import type { ComponentProps } from "react";

/** The page's on/off switch; name it with a wrapping `<label>` or `aria-label`. */
export function ToggleSwitch(props: Omit<ComponentProps<typeof Switch.Root>, "className" | "children">) {
	return (
		<Switch.Root
			{...props}
			className="inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[checked]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 motion-reduce:transition-none"
		>
			<Switch.Thumb className="size-3 rounded-full bg-background shadow-xs transition-transform data-[checked]:translate-x-3 motion-reduce:transition-none" />
		</Switch.Root>
	);
}
