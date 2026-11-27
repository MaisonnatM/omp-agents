/** A Workspace's quick links, the row under its tabs as a Slack channel's bookmarks bar: each opens its address, a right-click edits, copies, or removes it, and the last button adds one. */
import { IconPlusSmall } from "central-icons";
import { type FormEvent, useId, useState } from "react";
import { type BoardChange, type BoardState, MAX_TITLE, MAX_URL, type QuickLink, refusal } from "../../../templates/omp/agent/extensions/board/log";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../../activity";
import { ERROR_TEXT, FormDialog, FormDialogHeader } from "../form-dialog";
import { FIELD, Field } from "../form-field";
import { hostOf, SiteIcon } from "../site-icon";
import { cn } from "@/lib/utils";

const USER = { kind: "user" } as const;

interface QuickLinksProps {
	workspace: string;
	state: BoardState;
	disabled: boolean;
	onChange: (change: BoardChange) => Promise<void>;
}

export function QuickLinks({ workspace, state, disabled, onChange }: QuickLinksProps) {
	const links = state.links.filter(link => link.workspace === workspace);
	// The link the dialog edits, `"new"` while it adds one.
	const [editing, setEditing] = useState<QuickLink | "new" | null>(null);
	const add = (
		<Button variant="ghost" size={links.length ? "icon-xs" : "xs"} iconLeft={!links.length} disabled={disabled} aria-label="Add a quick link" onClick={() => setEditing("new")} className="shrink-0 text-muted-foreground" {...activityControl("board.quick-link.add")}>
			<IconPlusSmall aria-hidden />
			{!links.length && "Add a quick link"}
		</Button>
	);
	return (
		<nav aria-label="Quick links" className="flex shrink-0 items-center gap-0.5 overflow-x-auto px-5 py-1 shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] max-phone:px-2">
			{links.map(link => (
				<ContextMenu key={link.url}>
					<ContextMenuTrigger
						render={<a href={link.url} target="_blank" rel="noreferrer" title={link.url} className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-foreground/85 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" {...activityControl("board.quick-link")} />}
					>
						<SiteIcon hostname={hostOf(link.url)} />
						<span className="max-w-48 truncate">{link.title}</span>
					</ContextMenuTrigger>
					<ContextMenuContent>
						<MenuItem disabled={disabled} onClick={() => setEditing(link)}>
							Edit
						</MenuItem>
						<MenuItem onClick={() => void navigator.clipboard.writeText(link.url)}>Copy link</MenuItem>
						<MenuSeparator />
						<MenuItem variant="destructive" disabled={disabled} onClick={() => void onChange({ op: "unlink", by: USER, workspace, url: link.url })}>
							Remove
						</MenuItem>
					</ContextMenuContent>
				</ContextMenu>
			))}
			{links.length ? (
				<Tooltip content="Add a quick link" side="bottom">
					{add}
				</Tooltip>
			) : (
				add
			)}
			{editing && <LinkDialog workspace={workspace} editing={editing === "new" ? null : editing} state={state} onChange={onChange} onClose={() => setEditing(null)} />}
		</nav>
	);
}

/** `typed` as an address: `https://` goes before one typed without a scheme, as a browser's address bar does. */
const addressOf = (typed: string): string => (/^[a-z][a-z\d+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);

/** The form that adds a quick link, or edits `editing`; a blank name takes the address's host. */
function LinkDialog({ workspace, editing, state, onChange, onClose }: { workspace: string; editing: QuickLink | null; state: BoardState; onChange: (change: BoardChange) => Promise<void>; onClose: () => void }) {
	const ids = { url: useId(), title: useId() };
	const [url, setUrl] = useState(editing?.url ?? "");
	const [title, setTitle] = useState(editing?.title ?? "");
	const [error, setError] = useState<string | null>(null);
	const save = (event: FormEvent) => {
		event.preventDefault();
		const address = addressOf(url.trim());
		const name = title.trim() || (hostOf(address)?.replace(/^www\./, "") ?? "");
		const change: BoardChange = { op: "link", by: USER, workspace, url: address, title: name, ...(editing ? { replaces: editing.url } : {}) };
		const refused = refusal(state, change);
		if (refused) return setError(refused);
		onClose();
		void onChange(change);
	};
	return (
		<FormDialog busy={false} onClose={onClose} className="top-24 w-[min(28rem,calc(100vw-2rem))]">
			<FormDialogHeader title={editing ? "Edit quick link" : "Add a quick link"} busy={false} />
			<form onSubmit={save} className="flex flex-col gap-3 px-4 pt-3 pb-4">
				<Field label="Link" htmlFor={ids.url}>
					<input id={ids.url} autoFocus value={url} maxLength={MAX_URL} placeholder="https://linear.app/…" onChange={event => (setUrl(event.target.value), setError(null))} className={cn(FIELD, "w-full")} />
				</Field>
				<Field label="Name" htmlFor={ids.title}>
					<input id={ids.title} value={title} maxLength={MAX_TITLE} placeholder={hostOf(addressOf(url.trim()))?.replace(/^www\./, "") || "The site's name"} onChange={event => setTitle(event.target.value)} className={cn(FIELD, "w-full")} />
				</Field>
				{error && (
					<p role="alert" className={ERROR_TEXT}>
						{error}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" size="compact" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" size="compact" disabled={!url.trim()}>
						{editing ? "Save" : "Add"}
					</Button>
				</div>
			</form>
		</FormDialog>
	);
}
