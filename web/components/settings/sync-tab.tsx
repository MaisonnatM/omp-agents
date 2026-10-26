import { RefreshCcw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_SYNC_SETTINGS, NEVER_SYNCED, SYNC_ITEMS, type SyncAnswer, type SyncConflict, type SyncOutcome, type SyncSettings, type SyncSide, type SyncSkip } from "../../../src/shared/settings-sync";
import { errorText } from "../../../src/json";
import { putJson } from "../../api";
import { useEditableRead } from "../../editable-read";
import { age } from "../../labels";
import { IntegrationList } from "../integrations/integration-row";
import { FIELD, Section, SettingSwitch } from "./editor";

const SKIP_REASON: Record<SyncSkip["reason"], string> = { link: "a link", binary: "not text", large: "over 1 MB", credential: "looks like it holds a credential" };
const SIDE_LABEL: Record<SyncSide, string> = { local: "This machine", remote: "Remote" };
const ITEM_LABEL = Object.fromEntries(SYNC_ITEMS.map(item => [item.id, item.label]));
const ago = (at: number): string => (Date.now() - at < 60_000 ? "just now" : `${age(at)} ago`);

function Paths({ label, paths }: { label: string; paths: string[] }) {
	if (paths.length === 0) return null;
	return (
		<p className="text-xs text-muted-foreground">
			{label}: <span className="font-mono">{paths.join(", ")}</span>
		</p>
	);
}

function Skipped({ skipped }: { skipped: SyncSkip[] }) {
	if (skipped.length === 0) return null;
	return (
		<div className="space-y-1 text-xs text-muted-foreground">
			<p>Left on this machine:</p>
			<ul className="space-y-0.5">
				{skipped.map(skip => (
					<li key={skip.path}>
						<span className="font-mono">{skip.path}</span>, {SKIP_REASON[skip.reason]}
					</li>
				))}
			</ul>
		</div>
	);
}

function ConflictRow({ conflict, choice, onChoose }: { conflict: SyncConflict; choice: SyncSide | undefined; onChoose: (side: SyncSide) => void }) {
	return (
		<li className="space-y-2 px-4 py-3">
			<div className="flex flex-wrap items-center gap-3">
				<div className="min-w-0 flex-1">
					<p className="truncate font-mono text-[13px]">{conflict.path}</p>
					<p className="text-xs text-muted-foreground">{ITEM_LABEL[conflict.item]}</p>
				</div>
				<div role="group" aria-label={`Keep ${conflict.path} from`} className="flex gap-1">
					{(["local", "remote"] as const).map(side => (
						<Button key={side} variant="ghost" size="compact" active={choice === side} aria-pressed={choice === side} onClick={() => onChoose(side)}>
							{SIDE_LABEL[side]}
						</Button>
					))}
				</div>
			</div>
			<details className="text-xs">
				<summary className="cursor-pointer text-muted-foreground">Compare</summary>
				<div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
					{(["local", "remote"] as const).map(side => (
						<section key={side} className="min-w-0 space-y-1">
							<h4 className="font-medium">{SIDE_LABEL[side]}</h4>
							<pre aria-label={`${conflict.path} on ${SIDE_LABEL[side].toLowerCase()}`} className="max-h-80 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2">
								{conflict[side] ?? "Deleted"}
							</pre>
						</section>
					))}
				</div>
			</details>
		</li>
	);
}

function LastSync({ last }: { last: SyncOutcome | null }) {
	if (!last) return <p className="text-xs text-muted-foreground">Not synced yet.</p>;
	switch (last.kind) {
		case "failed":
			return (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					Sync failed {ago(last.at)}: {last.error}
				</p>
			);
		case "conflict":
			return null;
		case "synced":
			return (
				<div className="space-y-1">
					<p role="status" className="text-xs text-muted-foreground">
						Synced {ago(last.at)}.{last.received.length + last.sent.length === 0 && " Nothing changed."}
					</p>
					<Paths label="Received" paths={last.received} />
					<Paths label="Sent" paths={last.sent} />
					<Skipped skipped={last.skipped} />
				</div>
			);
		default: {
			const unhandled: never = last;
			return unhandled;
		}
	}
}

/** The Git remote that carries the portable settings between machines, a sync, its last outcome and conflicts, and what syncs. */
export function SyncTab({ active }: { active: boolean }) {
	const read = useEditableRead<SyncAnswer>(active ? "/api/sync" : null);
	const [draft, setDraft] = useState<Pick<SyncSettings, "remote" | "branch"> | null>(null);
	const [pending, setPending] = useState<"save" | "sync" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [choices, setChoices] = useState<Record<string, SyncSide>>({});
	const answer = read.data;
	const settings = answer?.settings ?? DEFAULT_SYNC_SETTINGS;
	const shown = draft ?? settings;
	const last = answer?.last ?? null;
	const conflicted = last?.kind === "conflict" ? last : null;

	const send = async (kind: "save" | "sync", request: () => Promise<SyncAnswer>): Promise<boolean> => {
		setPending(kind);
		setError(null);
		try {
			await read.write(request);
			return true;
		} catch (err) {
			setError(errorText(err));
			return false;
		} finally {
			setPending(null);
		}
	};
	const save = (next: SyncSettings): Promise<boolean> => send("save", () => putJson("/api/sync", next));
	const sync = async (chosen: Record<string, SyncSide>): Promise<void> => {
		if (await send("sync", () => putJson("/api/sync/run", { choices: chosen }))) setChoices({});
	};
	const submit = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (await save({ ...settings, ...shown })) setDraft(null);
	};
	const changed = draft !== null && (draft.remote.trim() !== settings.remote || draft.branch.trim() !== settings.branch);
	const decided = conflicted?.conflicts.every(conflict => choices[conflict.path]) ?? false;

	return (
		<>
			<Section title="Remote" meta="A Git repository only you can read, such as a private GitHub repository. Sync uses this machine's git credentials and never asks for a password.">
				<form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
					<label className="space-y-1 text-sm">
						Remote
						<input value={shown.remote} onChange={event => setDraft({ ...shown, remote: event.target.value })} placeholder="git@github.com:you/omp-settings.git" className={`${FIELD} block w-96 max-w-full`} />
					</label>
					<label className="space-y-1 text-sm">
						Branch
						<input value={shown.branch} onChange={event => setDraft({ ...shown, branch: event.target.value })} className={`${FIELD} block w-32`} />
					</label>
					<Button type="submit" variant="secondary" size="compact" loading={pending === "save"} disabled={!answer || pending !== null || !changed}>
						Save
					</Button>
				</form>
			</Section>
			<Section
				title="Sync"
				meta="Fetches the remote, merges each file with this machine's against the last sync, sends what changed here, and writes what changed there."
				actions={
					<Button variant="secondary" size="compact" leadingIcon={RefreshCcw} loading={pending === "sync"} disabled={!answer || pending !== null || settings.remote === ""} onClick={() => void sync({})}>
						Sync
					</Button>
				}
			>
				{read.error && <p className="text-xs text-red-600 dark:text-red-400">{read.error}</p>}
				{error && (
					<p role="alert" className="text-xs text-red-600 dark:text-red-400">
						{error}
					</p>
				)}
				{answer && settings.remote === "" && <p className="text-xs text-muted-foreground">Name a remote above to sync.</p>}
				{answer && <LastSync last={last} />}
				{conflicted && (
					<div className="space-y-3">
						<p role="alert" className="text-xs">
							{conflicted.conflicts.length === 1 ? "1 file" : `${conflicted.conflicts.length} files`} changed both here and on the remote. The sync {ago(conflicted.at)} changed nothing on either side; choose which version each keeps, then sync again.
						</p>
						<IntegrationList label="Conflicts">
							{conflicted.conflicts.map(conflict => (
								<ConflictRow key={conflict.path} conflict={conflict} choice={choices[conflict.path]} onChoose={side => setChoices(now => ({ ...now, [conflict.path]: side }))} />
							))}
						</IntegrationList>
						<Skipped skipped={conflicted.skipped} />
						<Button variant="primary" size="compact" leadingIcon={RefreshCcw} loading={pending === "sync"} disabled={pending !== null || !decided} onClick={() => void sync(choices)}>
							Sync with these choices
						</Button>
					</div>
				)}
			</Section>
			<Section title="What syncs" meta="Turning an item off leaves it as it is, here and on the remote.">
				<IntegrationList label="Synced items">
					{SYNC_ITEMS.map(item => {
						const on = !settings.excluded.includes(item.id);
						return (
							<li key={item.id}>
								<label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
									<div className="min-w-0 flex-1">
										<p className="truncate text-[13px] font-medium">{item.label}</p>
										<p className="truncate text-xs text-muted-foreground">{item.detail}</p>
									</div>
									<SettingSwitch
										label={`Sync ${item.label}`}
										checked={on}
										disabled={!answer || pending !== null}
										onCheckedChange={next => void save({ ...settings, excluded: next ? settings.excluded.filter(id => id !== item.id) : [...settings.excluded, item.id] })}
									/>
								</label>
							</li>
						);
					})}
				</IntegrationList>
			</Section>
			<Section title="Never synced" meta="These stay on the machine that has them, whatever the remote holds.">
				<ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
					{NEVER_SYNCED.map(rule => (
						<li key={rule.what}>{rule.what}</li>
					))}
					<li>Links, binary files, files over 1 MB, and files with text shaped like a token or a private key</li>
					<li>Routines, todos, pins, workspaces, calendars, and notices, which hold this machine's sessions and runs</li>
				</ul>
			</Section>
		</>
	);
}
