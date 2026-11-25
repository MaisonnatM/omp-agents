/** `useNoticeToasts`: the toasts of the notices the user has not seen, kept in step with them. */
import { useEffect, useRef } from "react";
import type { Notice } from "../../src/shared/notices";
import type { ClientMsg } from "../../src/shared/protocol";
import { follow, presentNotice } from "../notice-model";
import type { StartOp } from "../starts";
import { NoticeOrigin } from "./notices";
import { type ToastData, toasts } from "./toaster";

/** A news toast shows only while its news is this fresh, so a check after a long gap does not toast what you missed. */
const TOAST_FRESH_MS = 15 * 60_000;

/**
 * Shows each notice the user has not seen as a toast, under the logo and name of its source; closing it marks the notice seen, so it toasts once across reloads
 * and pages. An update's toast stays until dismissed and keeps its text and **Update** in step with the notice. Any
 * other notice's toast shows only while its news is fresh and opens what it is about, or resumes its sessions with
 * **Continue all**, for as long as its presentation says.
 */
export function useNoticeToasts(notices: Notice[], connected: boolean, send: (msg: ClientMsg) => void, start: (op: StartOp) => void): void {
	const open = useRef(new Set<string>());
	useEffect(() => {
		const close = (id: string) => {
			open.current.delete(id);
			toasts.dismiss(id);
		};
		const listed = new Set(notices.map(({ id }) => id));
		for (const id of open.current) if (!listed.has(id)) close(id);
		const now = Date.now();
		for (const notice of notices) {
			const { id } = notice;
			const shown = presentNotice(notice, now);
			const onDismiss = () => {
				if (open.current.delete(id)) send({ t: "notice", ids: [id], op: "seen" });
			};
			const { toast, action } = shown;
			if (toast.kind === "news") {
				if (open.current.has(id)) {
					if (notice.read) close(id);
					continue;
				}
				if (notice.seen || notice.read || now - notice.at > TOAST_FRESH_MS) continue;
				open.current.add(id);
				toasts({
					id,
					data: { source: <NoticeOrigin notice={notice} /> } satisfies ToastData,
					duration: toast.duration,
					onDismiss,
					title: shown.headline,
					description: <span className="line-clamp-2">{shown.preview}</span>,
					action:
						action.kind === "continue-all"
							? {
									label: "Continue all",
									dismiss: false,
									onAction: () => {
										start({ kind: "resume-all", sessionIds: action.sessionIds });
										send({ t: "notice", ids: [id], op: "read" });
									},
								}
							: shown.link === null
								? undefined
								: {
										label: "Open",
										dismiss: false,
										onAction: () => {
											follow(shown.link);
											send({ t: "notice", ids: [id], op: "read" });
										},
									},
				});
				continue;
			}
			const content = {
				title: shown.headline,
				action: action.kind === "update" ? { label: action.updating ? "Updating" : "Update", dismiss: false, onAction: () => send({ t: "notice", ids: [id], op: "update" }) } : undefined,
				description: shown.preview,
				data: { source: <NoticeOrigin notice={notice} />, actionDisabled: action.kind === "update" && (!connected || !action.ready) } satisfies ToastData,
			};
			if (!open.current.has(id)) {
				if (notice.seen) continue;
				open.current.add(id);
				toasts({ id, duration: Infinity, onDismiss, ...content });
			} else if (toast.dismissedElsewhere) {
				close(id);
			} else {
				toasts.update(id, content);
			}
		}
	}, [notices, connected, send, start]);
}
