import { useContext, useState } from "react";
import type { ContextUsage } from "../../src/shared/sessions";
import type { CompactionState, ContextAction } from "../../src/shared/session-controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuSeparator, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger, MenuSwitchItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { ComposerEditor } from "./composer";

const FILLING = 0.7;
const NEARLY_FULL = 0.9;
const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const tokens = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const ringClass = (used: number) => cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring", used >= NEARLY_FULL ? "text-red-600 dark:text-red-400" : used >= FILLING ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground");

function Ring({ used, running = false }: { used: number; running?: boolean }) {
	return <>
		<svg viewBox="0 0 18 18" className={cn("size-[18px] -rotate-90", running && "motion-safe:animate-pulse")} aria-hidden="true">
			<circle cx="9" cy="9" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={2} />
			<circle cx="9" cy="9" r={RADIUS} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - used)} className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none" />
		</svg>
		<span aria-hidden="true">{Math.round(used * 100)}%</span>
	</>;
}

const usageLabel = (context: ContextUsage) => `Context ${Math.round(context.tokens / context.window * 100)}% full: ${tokens.format(context.tokens)} of ${tokens.format(context.window)} tokens`;

export function ContextRing({ context }: { context: ContextUsage }) {
	const used = Math.min(context.tokens / context.window, 1);
	return <Tooltip content={usageLabel(context)}><span {...activityControl("composer.context-ring")} role="meter" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)} aria-valuetext={usageLabel(context)} tabIndex={0} className={ringClass(used)}><Ring used={used} /></span></Tooltip>;
}

export function ContextRingMenu({ context, compaction, working, pending, autoPending, onAction, onAutoChange, onFocus }: {
	context: ContextUsage;
	compaction: CompactionState;
	working: boolean;
	pending: boolean;
	autoPending: boolean;
	onAction: (action: ContextAction) => void;
	onAutoChange: (enabled: boolean) => void;
	onFocus: (command: string) => void;
}) {
	const composer = useContext(ComposerEditor);
	const [open, setOpen] = useState(false);
	const used = Math.min(context.tokens / context.window, 1);
	const busy = compaction.running !== null;
	const disabled = working || busy || pending;
	const reason = busy ? "Compacting…" : working ? "Wait for the turn to end, or stop it." : undefined;
	return <DropdownMenu open={open} onOpenChange={setOpen}>
		<Tooltip content={busy ? "Compacting…" : usageLabel(context)} forceOpen={open ? false : undefined}>
			<DropdownMenuTrigger {...activityControl("composer.context-ring")} render={<Button variant="ghost" size="compact" active={open} className={ringClass(used)} />} aria-label={busy ? "Compacting…" : `${usageLabel(context)}. Context actions`}><span className="inline-flex items-center gap-1.5"><Ring used={used} running={busy} /></span></DropdownMenuTrigger>
		</Tooltip>
		<DropdownMenuContent side="top" align="end" className="w-64" finalFocus={() => { composer?.current?.focus(); return composer ? false : true; }}>
			<div className="px-2 py-1.5 text-xs tabular-nums text-muted-foreground">{tokens.format(context.tokens)} of {tokens.format(context.window)}{compaction.thresholdTokens !== null && ` · auto at ${Math.round(compaction.thresholdTokens / context.window * 100)}%`}</div>
			<MenuSeparator />
			<MenuSubmenu><MenuSubmenuTrigger disabled={disabled} title={reason}>Compact</MenuSubmenuTrigger><MenuSubmenuContent>
				<MenuItem onClick={() => onAction({ kind: "compact", mode: null })}>Summarize</MenuItem>
				<MenuItem onClick={() => onAction({ kind: "compact", mode: "soft" })}>Summarize locally</MenuItem>
				<MenuItem onClick={() => onAction({ kind: "compact", mode: "remote" })}>Server compaction</MenuItem>
				<MenuItem onClick={() => onAction({ kind: "compact", mode: "snapcompact" })}>Snapshot to images</MenuItem>
				<MenuSeparator /><MenuItem onClick={() => onFocus("/compact ")}>With focus…</MenuItem>
			</MenuSubmenuContent></MenuSubmenu>
			<MenuSubmenu><MenuSubmenuTrigger disabled={disabled} title={reason}>Shake out</MenuSubmenuTrigger><MenuSubmenuContent>
				<MenuItem onClick={() => onAction({ kind: "shake", mode: "elide" })}>Tool results and large blocks</MenuItem>
				<MenuItem onClick={() => onAction({ kind: "shake", mode: "images" })}>Images</MenuItem>
				<MenuItem onClick={() => onAction({ kind: "shake", mode: "thinking" })}>Thinking</MenuItem>
			</MenuSubmenuContent></MenuSubmenu>
			<MenuSubmenu><MenuSubmenuTrigger disabled={disabled} title={reason}>Hand off</MenuSubmenuTrigger><MenuSubmenuContent>
				<MenuItem onClick={() => onAction({ kind: "handoff" })}>Hand off</MenuItem>
				<MenuItem onClick={() => onFocus("/handoff ")}>With focus…</MenuItem>
			</MenuSubmenuContent></MenuSubmenu>
			<MenuSeparator />
			<MenuSwitchItem checked={compaction.auto} disabled={autoPending} onCheckedChange={onAutoChange} title="Applies to this session only. New sessions use your omp compaction settings.">Auto-compact</MenuSwitchItem>
		</DropdownMenuContent>
	</DropdownMenu>;
}
