/** The ask a start refused for untrusted project code opens: the pieces the project would run, to trust and start, or cancel. */
import { useState } from "react";
import { errorText } from "../../src/json";
import type { ProjectCodeKind, TrustAsk } from "../../src/shared/project-trust";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ERROR_TEXT, FormDialog, FormDialogHeader } from "./form-dialog";

/** The label each piece shows before its path or server name. */
const KIND_LABELS: Record<ProjectCodeKind, string> = {
	extension: "Extension",
	hook: "Hook",
	tool: "Tool",
	command: "Slash command",
	"mcp-server": "MCP server",
	settings: "Settings",
	lsp: "Language servers",
};

/** Where the answer stands: asked, saving the trust, or refused with why it could not be saved. */
type Answer = { kind: "asking" } | { kind: "trusting" } | { kind: "failed"; error: string };

interface ProjectTrustDialogProps {
	ask: TrustAsk;
	/** Trusts every piece listed, then sends the refused start again; rejects with why the trust could not be saved. */
	onTrust: () => Promise<void>;
	/** Closes the dialog; the refused start's error stays where it shows. */
	onCancel: () => void;
}

export function ProjectTrustDialog({ ask, onTrust, onCancel }: ProjectTrustDialogProps) {
	const [answer, setAnswer] = useState<Answer>({ kind: "asking" });
	const busy = answer.kind === "trusting";
	const trust = (): void => {
		setAnswer({ kind: "trusting" });
		onTrust().catch((error: unknown) => setAnswer({ kind: "failed", error: errorText(error) }));
	};
	return (
		<FormDialog busy={busy} onClose={onCancel} className="top-12 w-[min(36rem,calc(100vw-2rem))]">
			<FormDialogHeader title="Trust this project's agent code?" busy={busy} />
			<div className="space-y-4 p-4">
				<div className="space-y-1">
					<p className="break-all font-mono text-xs text-muted-foreground">{ask.rootDisplay}</p>
					<p className="text-sm">The session would run this code from the project, with your permissions. Trust it only if you trust where it came from.</p>
				</div>
				<ul className="space-y-1.5" aria-label="Agent code in this project">
					{ask.code.map(piece => (
						<li key={piece.id} className="flex items-center gap-2 text-sm">
							<span className="shrink-0 text-muted-foreground">{KIND_LABELS[piece.kind]}</span>
							<span className="min-w-0 truncate font-mono text-xs" title={piece.name}>
								{piece.name}
							</span>
							<Badge variant="dot" size="compact" color={piece.change === "new" ? "blue" : "amber"} className="ml-auto shrink-0">
								{piece.change === "new" ? "New" : "Changed"}
							</Badge>
						</li>
					))}
				</ul>
				{answer.kind === "failed" && <p role="alert" className={ERROR_TEXT}>{answer.error}</p>}
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
					<Button type="button" disabled={busy} onClick={trust}>{busy ? "Trusting…" : "Trust and start"}</Button>
				</div>
			</div>
		</FormDialog>
	);
}
