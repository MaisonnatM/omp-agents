/** `PermissionRequest`, after affectUI's permission request: a session asks to use a tool, with why, what it will do, how long the answer lasts, and Deny or Allow. */
import { IconShield } from "central-icons";
import { type HTMLAttributes, type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KeyHint } from "./approval-card";

/** One way to allow: its label and the key that sends it. */
export interface PermissionScope {
	label: string;
	hint: string;
}

interface PermissionRequestProps extends HTMLAttributes<HTMLDivElement> {
	tool: string;
	/** The line under the heading, such as where the tool comes from. */
	sub?: string;
	reason?: string;
	/** What the call will do, one line each. */
	details: string[];
	/** The row above the card's head: its status and dismiss. */
	label: ReactNode;
	scopes: PermissionScope[];
	scope: number;
	onScope: (index: number) => void;
	denyHint: string;
	onAllow: () => void;
	onDeny: () => void;
}

/**
 * The head names the session's ask and the tool, a barred line says why, and a hairline section lists what the call
 * does. Under it, the ways to allow are segmented pills when there are several, then Deny and Allow, each with its key.
 */
export function PermissionRequest({ tool, sub, reason, details, label, scopes, scope, onScope, denyHint, onAllow, onDeny, className, ...rest }: PermissionRequestProps) {
	const headingId = useId();
	return (
		<div role="group" aria-labelledby={headingId} className={cn("w-full overflow-hidden rounded-[10px] bg-card shadow-surface-2", className)} {...rest}>
			<div className="flex items-center gap-2 px-4 pt-3 text-[12px] text-muted-foreground">{label}</div>
			<div className="flex items-start gap-3 px-4 pt-2">
				<span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
					<IconShield className="size-4" />
				</span>
				<div className="min-w-0 flex-1 pt-0.5">
					<h3 id={headingId} className="text-[14px] leading-5 text-muted-foreground">
						The session wants to use <strong className="font-medium text-foreground">{tool}</strong>
					</h3>
					{sub && <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{sub}</p>}
				</div>
			</div>
			{reason && <p className="mt-3 mr-4 ml-[54px] border-l-2 border-border pl-2.5 text-[12px] leading-[18px] text-muted-foreground">{reason}</p>}
			{details.length > 0 && (
				<div className="mt-3 border-t border-border px-4 pt-2.5 pb-3">
					<p className="text-[11px] font-medium text-muted-foreground">What will happen</p>
					<pre className="mt-1.5 max-h-48 overflow-auto font-mono text-[12px] leading-[18px] whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{details.join("\n")}</pre>
				</div>
			)}
			<div className="flex flex-col gap-3 border-t border-border px-4 pt-3 pb-4">
				{scopes.length > 1 && (
					<div role="radiogroup" aria-label="Allow for" className="flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
						{scopes.map((option, index) => (
							<button
								key={option.label}
								type="button"
								role="radio"
								aria-checked={index === scope}
								onClick={() => onScope(index)}
								className={cn(
									"min-h-7 min-w-0 flex-1 basis-auto rounded-md px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:outline-none",
									index === scope ? "bg-card text-foreground shadow-surface-2" : "text-muted-foreground hover:text-foreground",
								)}
							>
								{option.label}
							</button>
						))}
					</div>
				)}
				<div className="flex items-center justify-end gap-2">
					<Button variant="outline" size="compact" onClick={onDeny} className="pr-1.5">
						<span className="inline-flex items-center gap-1.5">
							Deny
							<KeyHint>{denyHint}</KeyHint>
						</span>
					</Button>
					<Button size="compact" onClick={onAllow} className="pr-1.5">
						<span className="inline-flex items-center gap-1.5">
							Allow
							<KeyHint>{scopes[scope]?.hint}</KeyHint>
						</span>
					</Button>
				</div>
			</div>
		</div>
	);
}
