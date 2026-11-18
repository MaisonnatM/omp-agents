/** `PermissionRequest`: a session asks to use a tool, in the yes-or-no card's tray, with the command in the card and one button per answer in its foot. */
import type { HTMLAttributes, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApprovalCard, KeyHint } from "./approval-card";

/** One way to answer: its label and the key that sends it. */
interface PermissionChoice {
	label: string;
	hint: string;
}

interface PermissionRequestProps extends HTMLAttributes<HTMLDivElement> {
	tool: string;
	/** Where the tool comes from, or why it asks; one muted line. */
	reason?: string;
	/** What the call will do, one line each. */
	details: string[];
	/** The status row: when omp stops waiting, and Dismiss. */
	label: ReactNode;
	/** The allow choices, the narrowest first. */
	allows: PermissionChoice[];
	denyHint: string;
	onAllow: (index: number) => void;
	onDeny: () => void;
}

function Choice({ label, hint, primary, onClick }: PermissionChoice & { primary?: boolean; onClick: () => void }) {
	return (
		<Button variant={primary ? "primary" : "ghost"} size="compact" onClick={onClick} className={cn("pr-1.5", !primary && "text-foreground")}>
			<span className="inline-flex items-center gap-1.5">
				{label}
				<KeyHint>{hint}</KeyHint>
			</span>
		</Button>
	);
}

/** Deny first, then the allow choices widest to narrowest, so Allow once, the default, sits rightmost as the primary. */
export function PermissionRequest({ tool, reason, details, label, allows, denyHint, onAllow, onDeny, ...rest }: PermissionRequestProps) {
	return (
		<ApprovalCard
			{...rest}
			title={`Allow ${tool}?`}
			description={reason}
			label={label}
			actions={
				<>
					<Choice label="Deny" hint={denyHint} onClick={onDeny} />
					{allows
						.map((choice, index) => ({ choice, index }))
						.reverse()
						.map(({ choice, index }) => (
							<Choice key={choice.label} label={choice.label} hint={choice.hint} primary={index === 0} onClick={() => onAllow(index)} />
						))}
				</>
			}
		>
			{details.length > 0 ? <pre className="max-h-32 overflow-auto font-mono text-[12px] leading-[18px] whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{details.join("\n")}</pre> : undefined}
		</ApprovalCard>
	);
}
