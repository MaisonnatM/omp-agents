import { Bell, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Notice, usesClause } from "../../src/shared/notices";
import type { ClientMsg } from "../../src/shared/protocol";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDashboardContext } from "./dashboard-context";
import { toasts } from "./toaster";

type Send = (msg: ClientMsg) => void;

function titleOf(notice: Notice): string {
	return `${notice.kind === "omp" ? `omp ${notice.latest}` : notice.to.name} is out`;
}

function detailOf(notice: Notice): string {
	switch (notice.status.state) {
		case "available":
			return notice.kind === "omp" ? `You run omp ${notice.current}.` : `${usesClause(notice.uses)} ${notice.from.name}.`;
		case "updating":
			return notice.kind === "omp" ? "Updating omp…" : `Switching to ${notice.to.name}…`;
		case "updated":
			return notice.status.note;
		case "failed":
			return notice.status.error;
	}
}

/** Whether **Update** is enabled: before the update runs, and again after it failed. */
const updatable = (notice: Notice): boolean => notice.status.state === "available" || notice.status.state === "failed";

/**
 * Shows each notice the user has not seen as a toast that stays until dismissed, then keeps the toast's text and
 * **Update** in step with the notice. Dismissing marks the notice seen, so it toasts once across reloads and pages.
 */
export function useNoticeToasts(notices: Notice[], connected: boolean, send: Send): void {
	const open = useRef(new Set<string>());
	useEffect(() => {
		const close = (id: string) => {
			open.current.delete(id);
			toasts.close(id);
		};
		const listed = new Set(notices.map(({ id }) => id));
		for (const id of open.current) if (!listed.has(id)) close(id);
		for (const notice of notices) {
			const { id } = notice;
			const content = {
				title: titleOf(notice),
				actionProps:
					notice.status.state === "updated"
						? undefined
						: {
								children: notice.status.state === "updating" ? "Updating" : "Update",
								disabled: !connected || !updatable(notice),
								onClick: () => send({ t: "notice", id, op: "update" }),
							},
				description: detailOf(notice),
			};
			const dismissedElsewhere = notice.seen && notice.status.state === "available";
			if (!open.current.has(id)) {
				if (notice.seen) continue;
				open.current.add(id);
				toasts.add({
					id,
					timeout: 0,
					onClose: () => {
						if (open.current.delete(id)) send({ t: "notice", id, op: "seen" });
					},
					...content,
				});
			} else if (dismissedElsewhere) {
				close(id);
			} else {
				toasts.update(id, content);
			}
		}
	}, [notices, connected, send]);
}

/** The header's bell: how many notices there are, and a list of them to update or clear. */
export function NoticesBell({ notices }: { notices: Notice[] }) {
	const { send, connected } = useDashboardContext();
	const [open, setOpen] = useState(false);
	const label = notices.length === 0 ? "Updates" : `Updates, ${notices.length}`;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip content="Updates" side="bottom" forceOpen={open ? false : undefined}>
				<PopoverTrigger asChild>
					<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label={label} data-state={open ? "open" : "closed"} active={open}>
						<Bell />
						{notices.length > 0 && (
							<span aria-hidden className="absolute -top-1.5 -right-2 h-3 min-w-3 rounded-full bg-primary px-0.5 text-center text-[8px] leading-3 tabular-nums text-primary-foreground">
								{notices.length}
							</span>
						)}
					</Button>
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent align="end" className="w-80 p-1">
				{notices.length === 0 ? (
					<p className="px-3 py-2 text-sm text-muted-foreground">omp and your models are up to date.</p>
				) : (
					<ul className="flex flex-col">
						{notices.map(notice => (
							<li key={notice.id} className="flex items-start gap-2 rounded-md px-3 py-2">
								<div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
									<span className="font-medium">{titleOf(notice)}</span>
									<span role={notice.status.state === "failed" ? "alert" : undefined} className={cn("text-xs", notice.status.state === "failed" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
										{detailOf(notice)}
									</span>
								</div>
								{notice.status.state !== "updated" && (
									<Button variant="secondary" size="compact" disabled={!connected || !updatable(notice)} onClick={() => send({ t: "notice", id: notice.id, op: "update" })}>
										{notice.status.state === "updating" ? "Updating" : "Update"}
									</Button>
								)}
								<Tooltip content="Clear">
									<Button variant="ghost" size="icon-compact" className="shrink-0" aria-label={`Clear: ${titleOf(notice)}`} disabled={!connected || notice.status.state === "updating"} onClick={() => send({ t: "notice", id: notice.id, op: "clear" })}>
										<X />
									</Button>
								</Tooltip>
							</li>
						))}
					</ul>
				)}
			</PopoverContent>
		</Popover>
	);
}
