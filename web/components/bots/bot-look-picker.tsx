/** `BotLookPicker`, a Bot's shape and color as two rows of choices, which New Bot and the Bot's details both show. */
import type { CSSProperties } from "react";
import { BOT_HUES, BOT_SHAPES, type BotHue, type BotLook } from "../../../src/shared/bots";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";

/** What a screen reader calls each hue, near enough to what it shows. */
const HUE_NAMES: Record<BotHue, string> = { 25: "Red", 70: "Orange", 110: "Yellow", 150: "Green", 195: "Teal", 235: "Blue", 275: "Violet", 320: "Pink" };

/** A choice's ring: muted on hover, the focus ring on keyboard focus, and the foreground once chosen. */
const CHOICE = "rounded-full ring-offset-2 ring-offset-background outline-none peer-hover:ring-2 peer-hover:ring-border peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50";

interface BotLookPickerProps {
	/** Groups the radios, so two pickers on one screen do not share a choice. */
	name: string;
	look: BotLook;
	onLook: (look: BotLook) => void;
	disabled?: boolean;
}

/** Native radios, so the arrow keys move along a row and Tab moves between the rows. */
export function BotLookPicker({ name, look, onLook, disabled = false }: BotLookPickerProps) {
	return (
		<div className="space-y-3">
			<fieldset className="space-y-1.5">
				<legend className="mb-1.5 text-xs font-medium text-muted-foreground">Shape</legend>
				<div className="flex flex-wrap gap-2">
					{BOT_SHAPES.map(shape => (
						<label key={shape} className="relative cursor-pointer has-disabled:cursor-default">
							<input
								type="radio"
								name={`${name}-shape`}
								value={shape}
								checked={look.shape === shape}
								disabled={disabled}
								onChange={() => onLook({ ...look, shape })}
								className="peer sr-only"
							/>
							<span className="sr-only">{shape}</span>
							<BotAvatar look={{ shape, hue: look.hue }} size="header" className={cn(CHOICE, "p-0.5")} />
						</label>
					))}
				</div>
			</fieldset>
			<fieldset className="space-y-1.5">
				<legend className="mb-1.5 text-xs font-medium text-muted-foreground">Color</legend>
				<div className="flex flex-wrap gap-2">
					{BOT_HUES.map(hue => (
						<label key={hue} className="relative cursor-pointer has-disabled:cursor-default">
							<input
								type="radio"
								name={`${name}-hue`}
								value={hue}
								checked={look.hue === hue}
								disabled={disabled}
								onChange={() => onLook({ ...look, hue })}
								className="peer sr-only"
							/>
							<span className="sr-only">{HUE_NAMES[hue]}</span>
							<span
								aria-hidden
								style={{ "--bot-hue": hue } as CSSProperties}
								className={cn(CHOICE, "block size-6 bg-[oklch(0.8_0.12_var(--bot-hue))] dark:bg-[oklch(0.74_0.12_var(--bot-hue))]")}
							/>
						</label>
					))}
				</div>
			</fieldset>
		</div>
	);
}
