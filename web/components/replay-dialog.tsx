import { useEffect, useId, useRef, useState } from "react";
import type { ReplayDetail } from "../../src/shared/replay";
import type { View } from "../../src/shared/sessions";
import { selectorOf } from "../../src/shared/models";
import type { ModelOption } from "../../src/shared/models";
import { Button } from "@/components/ui/button";
import { useRead } from "../reads";
import { useDraftModelSelection } from "../use-draft-model";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { ERROR_TEXT, FormDialog, FormDialogHeader, isSubmitChord } from "./form-dialog";
import { ModelPicker } from "./model-picker";

export function ReplayDialog({ view, turnId, onClose }: { view: View; turnId: string; onClose: () => void }) {
	const read = useRead<ReplayDetail>(`/api/replay/detail?${new URLSearchParams({ view: JSON.stringify(view), turnId })}`);
	return read.data ? <ReplayForm view={view} turnId={turnId} detail={read.data} onClose={onClose} /> : (
		<FormDialog busy={false} onClose={onClose} className="top-12 w-[min(42rem,calc(100vw-2rem))]">
			<FormDialogHeader title="Replay from here" busy={false} />
			<p role={read.error ? "alert" : "status"} className="p-4 text-sm">{read.error ?? "Reading the original prompt…"}</p>
		</FormDialog>
	);
}

function ReplayForm({ view, turnId, detail, onClose }: { view: View; turnId: string; detail: ReplayDetail; onClose: () => void }) {
	const { start, dismissStart } = useDashboardActions();
	const { connected, starts: { replay } } = useDashboardStatus();
	const models = useDraftModelSelection(detail.cwd, detail);
	const [originalSettings, setOriginalSettings] = useState(detail.model !== null);
	const [editing, setEditing] = useState(false);
	const [prompt, setPrompt] = useState(detail.prompt);
	const [submitted, setSubmitted] = useState(false);
	const sawStart = useRef(false);
	const promptId = useId();
	const matching = replay?.op.token === detail.token ? replay : null;
	const busy = replay?.phase === "starting";
	const model = originalSettings ? detail.model : models.model;
	const thinking = originalSettings ? detail.thinking : models.thinking;
	const concrete = thinking !== null && thinking !== "auto";
	const firstText = editing ? prompt : detail.prompt;
	const command = firstText.trimStart().startsWith("!") || /^\/(?!skill:)/.test(firstText.trimStart());
	const canStart = connected && !busy && model !== null && concrete && !command && (firstText.trim().length > 0 || detail.images.length > 0);
	useEffect(() => { dismissStart("replay"); }, [dismissStart]);
	useEffect(() => {
		if (!submitted) return;
		if (matching) sawStart.current = true;
		else if (sawStart.current) onClose();
	}, [submitted, matching, onClose]);
	const submit = () => {
		if (!canStart) return;
		setSubmitted(true);
		start({ kind: "replay", view, turnId, token: detail.token, model, thinking, prompt: editing ? prompt : null });
	};
	const picker = { ...models.picker, current: model && selectorOf(model), onPick: (next: ModelOption) => { setOriginalSettings(false); models.picker.onPick(next); }, effort: { ...models.picker.effort, current: thinking, allowDefault: false, levels: models.levels?.filter(level => level !== "auto") ?? null, onPick: (level: string | null) => { setOriginalSettings(false); models.pickThinking(level); } } };
	return (
		<FormDialog busy={busy} onClose={onClose} className="top-12 w-[min(42rem,calc(100vw-2rem))]">
			<FormDialogHeader title="Replay from here" busy={busy} />
			<form className="space-y-5 p-4" onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={event => { if (isSubmitChord(event)) { event.preventDefault(); submit(); } }}>
				<div className="space-y-2">
					<p className="text-sm">A new session replays this prompt in a detached checkout. The original session and checkout stay unchanged.</p>
					<p className="break-all text-xs text-muted-foreground">Repository: {detail.cwd}. The base is the last recorded HEAD before this prompt, or current HEAD if unavailable. Uncommitted historical files are not restored.</p>
				</div>
				<fieldset disabled={busy} className="space-y-2">
					<legend className="mb-2 text-sm font-medium">Model and thinking</legend>
					<div className="flex flex-wrap items-center gap-2">
						{detail.model && <Button type="button" variant={originalSettings ? "secondary" : "ghost"} size="compact" onClick={() => { setOriginalSettings(true); if (detail.model) models.picker.onPick(detail.model); }}>Use original settings</Button>}
						<ModelPicker {...picker} disabled={busy} />
					</div>
					<p className="text-xs text-muted-foreground">Original: {detail.model ? `${detail.model.provider}/${detail.model.id}` : "not recorded"}; thinking: {detail.thinking ?? "not recorded"}. {originalSettings ? "Same as original." : "Selected settings above."}</p>
					{!concrete && <p className="text-xs text-muted-foreground">Choose a concrete thinking level. Automatic thinking cannot reliably identify the first main request.</p>}
				</fieldset>
				<div className="space-y-2">
					<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing} disabled={busy} onChange={event => setEditing(event.target.checked)} />Edit the replay prompt</label>
					<label htmlFor={promptId} className="block text-xs font-medium">{editing ? "Replay prompt" : "Original prompt"}</label>
					<textarea id={promptId} value={editing ? prompt : detail.prompt} readOnly={!editing} disabled={busy} onChange={event => setPrompt(event.target.value)} rows={8} className="w-full resize-y rounded-md border bg-background p-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" />
					{command && <p className="text-xs text-muted-foreground">Shell and local slash commands cannot be replay prompts. Use text or /skill:&lt;name&gt;.</p>}
					{detail.images.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Original images retained in order">{detail.images.map((image, index) => <img key={index} alt={`Original attachment ${index + 1}`} src={`data:${image.mimeType};base64,${image.data}`} className="max-h-20 max-w-28 rounded border object-contain" />)}</div>}
				</div>
				<p className="rounded-md bg-muted p-3 text-xs">Shell, eval, task, direct LSP calls, MCP tools, and unknown executable devices are blocked. Local reads and audited in-checkout edits are allowed. This is a tool guard, not an OS sandbox: dependencies and startup extensions remain trusted, and outside reads may affect results. The separate terminal panel is not guarded.</p>
				{matching?.phase === "failed" && <p role="alert" className={ERROR_TEXT}>{matching.error}</p>}
				<div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={!canStart}>{busy ? "Starting replay…" : "Start replay"}</Button></div>
			</form>
		</FormDialog>
	);
}
