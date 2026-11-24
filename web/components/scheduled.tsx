/** Scheduled sends: their schedule menu, the composer's list of a session's scheduled messages, and the context that holds and adds them. */
import { IconClockAlert, IconCrossMedium, IconPencil, IconSend } from "central-icons";
import { createContext, useContext, useState } from "react";
import { promptLabel } from "../../src/shared/prompt-files";
import { CONTINUE_PROMPT, type ScheduledChange, type ScheduledSend, type ScheduledTarget } from "../../src/shared/scheduled";
import { DASHBOARD_PROMPT_PREFIX } from "../../src/shared/transcript";
import { opensWithShortcut } from "./composer";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { whenWords } from "../routines-model";
import { dateTimeInputValue, resetChoices, type ScheduleWhen, tomorrowMorning } from "../scheduled-model";
import { type Action, useAction } from "../use-action";
import { useMinute } from "../use-minute";
import { useDashboardActions } from "./dashboard-context";
import { Plans } from "./plan-usage";

const HOUR = 3_600_000;

/** Every scheduled send, as the server last sent them. */
export const ScheduledSends = createContext<readonly ScheduledSend[]>([]);

/** Adds a send that delivers `target` at `when`; resolves once the server saved it. */
export function useScheduleSend(): (target: ScheduledTarget, when: ScheduleWhen) => Promise<void> {
	const { request } = useDashboardActions();
	return (target, when) => request({ t: "schedule", change: { op: "add", send: { id: crypto.randomUUID(), at: when.at, reset: when.reset, target } } });
}

function useScheduledChange(failureTitle: string) {
	const { request } = useDashboardActions();
	return useAction((change: ScheduledChange) => request({ t: "schedule", change }), failureTitle);
}

/**
 * **Edit**: takes send `id` off the schedule, and only once the server confirms it hands `text` to `restore`.
 * The server refuses a send under way or gone, which then stays as it is while the refusal toasts.
 */
function useScheduledEdit(restore: (text: string) => void): Action<[id: string, text: string]> {
	const { request } = useDashboardActions();
	return useAction(async (id: string, text: string) => {
		await request({ t: "schedule", change: { op: "take", id } });
		restore(text);
	}, "Could not edit the scheduled message");
}

interface ScheduleButtonProps {
	/** The composer's text; the button shows only once it holds some, and a `!` or `$` command disables it. */
	draft: string;
	/** How many files the draft carries; a send keeps text only. */
	files: number;
	/** The composer takes no message now, or the server is gone. */
	disabled: boolean;
	pending: boolean;
	onSchedule: (when: ScheduleWhen) => void;
}

/** Send later: when a plan window resets, in an hour, tomorrow morning, or at a time picked by hand. Hidden while the draft is blank, which also closes its menu. */
export const ScheduleButton = (props: ScheduleButtonProps) => (props.draft.trim() === "" && !props.pending ? null : <ScheduleMenu {...props} />);

function ScheduleMenu({ draft, files, disabled, pending, onSchedule }: ScheduleButtonProps) {
	const [open, setOpen] = useState(false);
	const plans = useContext(Plans);
	const now = useMinute();
	// omp runs `!` and `$` only from the composer's own path, and a scheduled message goes to omp as a plain prompt.
	const blocked = files > 0 ? "Attached files cannot wait for later" : opensWithShortcut(draft) ? "A ! or $ command cannot wait for later" : null;
	const choices: { label: string; when: ScheduleWhen }[] = [
		...resetChoices(plans, now).map(when => ({ label: `When ${when.reset} resets`, when })),
		{ label: "In 1 hour", when: { at: now + HOUR, reset: null } },
		{ label: "Tomorrow morning", when: { at: tomorrowMorning(now), reset: null } },
	];
	const pick = (when: ScheduleWhen): void => {
		setOpen(false);
		onSchedule(when);
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip content={blocked ?? "Send later"} side="top" forceOpen={open ? false : undefined}>
				{/* A disabled button takes no pointer events, so the tooltip that says why sits on a wrapper. */}
				<span className="inline-flex">
					<PopoverTrigger asChild>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Send later"
							disabled={disabled || blocked !== null}
							loading={pending}
							data-state={open ? "open" : "closed"}
							active={open}
						>
							<IconClockAlert aria-hidden="true" />
						</Button>
					</PopoverTrigger>
				</span>
			</Tooltip>
			<PopoverContent align="end" side="top" className="w-72 p-1">
				<p className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">Send later</p>
				<ul aria-label="Send later">
					{choices.map(({ label, when }) => (
						<li key={label}>
							<button
								type="button"
								onClick={() => pick(when)}
								className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
							>
								<span className="min-w-0 flex-1 truncate">{label}</span>
								<span className="shrink-0 text-xs text-muted-foreground tabular-nums">{whenWords(when.at, now)}</span>
							</button>
						</li>
					))}
				</ul>
				<form
					onSubmit={event => {
						event.preventDefault();
						// React bubbles events through the popover's portal, so a form around the composer would submit too.
						event.stopPropagation();
						const value = new FormData(event.currentTarget).get("at");
						const at = typeof value === "string" ? new Date(value).getTime() : Number.NaN;
						if (at > Date.now()) pick({ at, reset: null });
					}}
					className="mt-1 flex items-center gap-1.5 border-t border-border px-1 pt-2 pb-1"
				>
					<input
						type="datetime-local"
						name="at"
						aria-label="Send at"
						required
						min={dateTimeInputValue(now)}
						defaultValue={dateTimeInputValue(now + HOUR)}
						className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
					/>
					<Button type="submit" variant="secondary" size="compact">
						Schedule
					</Button>
				</form>
			</PopoverContent>
		</Popover>
	);
}

/**
 * `Anthropic 5h reset · Today at 14:32`, or the time alone for one picked by hand. A continue says so:
 * `Continues when Anthropic 5h resets · Today at 14:32`, or, when its provider named no reset, that it tries at a guessed time;
 * a retry says what it retries after: `Retries after a connection error to Anthropic · Today at 14:32`.
 */
export function whenLabel(send: ScheduledSend, now: number): string {
	const when = whenWords(send.at, now);
	if (send.target.kind === "continue") {
		if (send.target.cause === "transient") return `Retries after a connection error to ${send.target.provider} · ${when}`;
		return send.reset ? `Continues when ${send.reset} resets · ${when}` : `Continues · ${when} · ${send.target.provider} did not say when its limit resets`;
	}
	return send.reset ? `${send.reset} reset · ${when}` : when;
}

/** The text a send delivers: its message, a continue's prompt, or a new session's first message. */
function sentText(target: ScheduledTarget): string {
	switch (target.kind) {
		case "message":
			return target.text.startsWith(DASHBOARD_PROMPT_PREFIX) ? target.text.slice(DASHBOARD_PROMPT_PREFIX.length).trimStart() : target.text;
		case "continue":
			return CONTINUE_PROMPT;
		case "start":
			return target.request.prompt;
		default: {
			const unhandled: never = target;
			return unhandled;
		}
	}
}

/** What a send's row says of its state, `null` while it waits. */
function stateLabel(send: ScheduledSend): string | null {
	switch (send.state.phase) {
		case "waiting":
			return null;
		case "sending":
			return "Sending…";
		case "failed":
			return `Not sent: ${send.state.error}`;
	}
}

interface ScheduledRowProps {
	send: ScheduledSend;
	text: string;
	now: number;
	/** An **Edit** in this composer waits on the server. */
	editing: boolean;
	onEdit: () => void;
}

function ScheduledRow({ send, text, now, editing, onEdit }: ScheduledRowProps) {
	const change = useScheduledChange("Could not change the scheduled message");
	const label = promptLabel(text);
	const failed = send.state.phase === "failed";
	const busy = send.state.phase === "sending" || change.pending || editing;
	const actions = [
		{ name: failed ? "Try again" : "Send now", icon: <IconSend aria-hidden="true" />, run: () => change.run({ op: "send-now", id: send.id }) },
		{ name: "Edit", icon: <IconPencil aria-hidden="true" />, run: onEdit },
		{ name: failed ? "Dismiss" : "Cancel", icon: <IconCrossMedium aria-hidden="true" />, run: () => change.run({ op: "remove", id: send.id }) },
	];
	return (
		<li className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1 text-[13px]">
			<IconClockAlert aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1">
				<span className="block truncate">{label}</span>
				<span className={cn("block truncate text-xs", failed ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{stateLabel(send) ?? whenLabel(send, now)}</span>
			</span>
			{actions.map(({ name, icon, run }) => (
				<Tooltip key={name} content={name} side="top">
					<Button variant="ghost" size="icon-sm" aria-label={`${name}: ${label}`} disabled={busy} onClick={run}>
						{icon}
					</Button>
				</Tooltip>
			))}
		</li>
	);
}

/** The messages scheduled for session `sessionId`, above its composer; `onEdit` gets the text of one **Edit** took off the schedule. */
export function ScheduledMessages({ sessionId, onEdit }: { sessionId: string | null; onEdit: (text: string) => void }) {
	const sends = useContext(ScheduledSends).flatMap(send => (send.target.kind !== "start" && send.target.sessionId === sessionId ? [{ send, text: sentText(send.target) }] : []));
	const now = useMinute();
	// Held here rather than in a row: a send that goes during the take leaves its row, and the refusal still has to toast.
	const edit = useScheduledEdit(onEdit);
	if (sends.length === 0) return null;
	return (
		<ul aria-label="Scheduled messages" data-im-queue className="flex flex-col gap-1 pb-1">
			{sends.map(({ send, text }) => (
				<ScheduledRow key={send.id} send={send} text={text} now={now} editing={edit.pending} onEdit={() => edit.run(send.id, text)} />
			))}
		</ul>
	);
}
