import * as Dialog from "@radix-ui/react-dialog";
import { Check, Circle, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../../src/json";
import type { AgentSettingChange, AgentSettingRow } from "../../../src/shared/agent-settings";
import type { OmpSettings } from "../../../src/shared/models";
import { CLEANUP_STEPS, type CleanupStep, type GcAnswer, type SandboxPlan, type StorageUsage } from "../../../src/shared/storage";
import { Button } from "@/components/ui/button";
import { ApiError, getJson, putJson } from "../../api";
import { activityControl } from "../../activity";
import { age, formatBytes } from "../../labels";
import { valueOf } from "../../omp-settings";
import { hashForSettings } from "../../routing";
import { cleanupRows, runCleanup, type CleanupRow, type CleanupRun, type StepProgress } from "../../storage";
import { ErrorText, LINK, Section } from "./editor";
import { SettingRow } from "./omp-settings-tab";

function UsageSection({ usage, error }: { usage: StorageUsage | null; error: string | null }) {
	return (
		<Section title="What omp uses" meta="Allocated disk space. Shared copies can make cleanup free less than the size shown.">
			<dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
				{usage ? usage.folders.map(folder => (
					<div key={folder.label}>
						<dt className="text-xs text-muted-foreground" title={folder.path}>{folder.label}</dt>
						<dd className="mt-1 min-h-7 text-xl font-semibold tabular-nums" title={folder.error ?? undefined}>
							{folder.bytes === null ? "Size unavailable" : formatBytes(folder.bytes)}
						</dd>
						{folder.error && <p className="text-xs text-muted-foreground">Too large to measure quickly, or unreadable.</p>}
					</div>
				)) : ["Session files", "Attachments", "Isolation sandboxes"].map(label => (
					<div key={label}>
						<dt className="text-xs text-muted-foreground">{label}</dt>
						<dd className="mt-1 flex h-7 items-center">
							<span aria-hidden className="h-3 w-12 rounded bg-muted motion-safe:animate-pulse" />
							<span className="sr-only">Measuring…</span>
						</dd>
					</div>
				))}
			</dl>
			{error && <ErrorText>Cannot measure storage. {error}</ErrorText>}
		</Section>
	);
}

interface ChecklistRowProps {
	row: CleanupRow;
	status: StepProgress | undefined;
	loading: boolean;
	finished: boolean;
	disabled: boolean;
	checked: boolean;
	onCheckedChange(checked: boolean): void;
}
function ChecklistRow({ row, status, loading, finished, disabled, checked, onCheckedChange }: ChecklistRowProps) {
	const errors = status?.errors ?? row.errors;
	return (
		<div className="py-3">
			<label className="flex items-start gap-3 text-sm">
				<input
					type="checkbox"
					checked={checked && row.available && row.count > 0}
					disabled={disabled || !row.available || row.count === 0}
					onChange={event => onCheckedChange(event.target.checked)}
					className="mt-1 size-3.5 accent-primary"
				/>
				<span className="min-w-0 flex-1">
					<span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
						<span className="font-medium">{row.label}</span>
						<span className="text-xs tabular-nums text-muted-foreground">{loading ? "Checking…" : row.size}</span>
					</span>
					<span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">{!loading && row.detail}</span>
					{!loading && row.step !== "archive" && row.available && (
						<span className="mt-1 block text-xs tabular-nums text-muted-foreground">
							{row.count} {row.unit[row.count === 1 ? 0 : 1]}
						</span>
					)}
				</span>
			</label>
			{status && (
				<p role="status" className="mt-2 flex items-center gap-2 pl-6 text-xs tabular-nums">
					{status.state === "running" ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" />
						: status.state === "done" ? <Check aria-hidden className="size-3" />
						: status.state === "failed" ? <X aria-hidden className="size-3" /> : <Circle aria-hidden className="size-3" />}
					{status.state === "waiting" && finished ? "Not run" : status.text}
				</p>
			)}
			{errors.map((error, index) => <div key={index} className="mt-1 pl-6"><ErrorText>{error}</ErrorText></div>)}
		</div>
	);
}

function Rules({ usage, onRefresh, onSaved, busy }: { usage: StorageUsage; onRefresh: () => Promise<void>; onSaved: () => void; busy: boolean }) {
	const save = async (row: AgentSettingRow, change: AgentSettingChange): Promise<void> => {
		try {
			await putJson<OmpSettings>("/api/settings/agent", { id: row.id, expected: row.user ?? null, ...change });
			onSaved();
		} catch (error) {
			if (error instanceof ApiError && error.conflict) throw new ApiError(`${row.label} changed on disk. It has been reloaded; review it and try again.`, true);
			throw error;
		} finally { await onRefresh(); }
	};
	const overrides = usage.rules.filter(row => usage.overrides.includes(row.id)).map(row => row.label.toLowerCase());
	return (
		<Section title="Cleanup rules" meta="Changes save immediately for all workspaces. These switches choose the default checklist, not a daily cleanup.">
			{usage.settingsError ? <ErrorText>Cannot load cleanup rules. {usage.settingsError}</ErrorText> : (
				<ul className="divide-y divide-border">
					{usage.rules.map(row => <SettingRow key={row.id} row={row} context={{ save }} disabled={busy} />)}
				</ul>
			)}
			{overrides.length > 0 && (
				<p className="text-xs text-muted-foreground">
					This workspace overrides {overrides.join(", ")} for terminal cleanup in that folder. Storage uses your global rules instead.
				</p>
			)}
			<p className="text-xs text-muted-foreground">
				Only daily compression starts automatically, and only when you launch omp in a terminal. The dashboard already removes safe isolation sandboxes once a day.
			</p>
			{usage.autoCompress && (
				<details className="text-xs text-muted-foreground">
					<summary className="cursor-pointer tabular-nums">
						Last background compression{usage.autoCompress.at > 0 ? ` · ${age(usage.autoCompress.at)} ago` : ""}
					</summary>
					<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">{usage.autoCompress.text || "No output was recorded."}</pre>
				</details>
			)}
		</Section>
	);
}

interface ConfirmDialogProps {
	open: boolean;
	onOpenChange(open: boolean): void;
	chosen: readonly CleanupRow[];
	sandboxes: readonly SandboxPlan[];
	label: string;
	onConfirm(): void;
}
function ConfirmDialog({ open, onOpenChange, chosen, sandboxes, label, onConfirm }: ConfirmDialogProps) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-5 text-foreground shadow-md">
					<Dialog.Title className="text-base font-medium">Clean up omp's files?</Dialog.Title>
					<Dialog.Description className="mt-1 text-sm text-muted-foreground">
						Cleanup runs one step at a time. Stopping waits for the current step to finish. Deleted files cannot be restored by the dashboard.
					</Dialog.Description>
					<ul className="my-4 space-y-2 text-sm">
						{chosen.map(row => (
							<li key={row.step} className="flex justify-between gap-4">
								<span>{row.label}</span><span className="tabular-nums text-muted-foreground">{row.size}</span>
							</li>
						))}
					</ul>
					{chosen.some(row => row.step === "archive") && (
						<p className="mt-2 text-sm">Cold sessions leave the roster, History, and Resume. Their compressed archive stays on disk.</p>
					)}
					{chosen.some(row => row.step === "stale") && <p className="mt-2 text-sm">Old debug reports and replicas are permanently deleted.</p>}
					{chosen.some(row => row.step === "sandboxes") && (
						<>
							<p className="mt-2 text-sm">
								Sandbox files, ignored files, and commits omp did not bring back are permanently deleted. Close other shells and editors using these folders first.
							</p>
							<details className="mt-3 text-xs text-muted-foreground">
								<summary className="cursor-pointer">Review sandboxes to remove</summary>
								<ul className="mt-2 space-y-2">
									{sandboxes.filter(plan => plan.kept === null).map(plan => (
										<li key={plan.path} className="flex items-baseline justify-between gap-4">
											<span className="break-all">{plan.path}</span>
											<span className="shrink-0 tabular-nums">{plan.bytes === null ? "Size unavailable" : formatBytes(plan.bytes)}</span>
										</li>
									))}
								</ul>
							</details>
						</>
					)}
					<div className="mt-5 flex justify-end gap-2">
						<Button variant="secondary" size="compact" onClick={() => onOpenChange(false)}>Cancel</Button>
						<Button variant="destructive-outline" size="compact" className="tabular-nums" leadingIcon={Trash2} onClick={onConfirm}>{label}</Button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/** Global cleanup remains mounted when switching Settings sections; leaving Settings stops later operations. */
export function StorageTab({ active, cwd, onSaved }: { active: boolean; cwd: string | null; onSaved: () => void }) {
	const [usage, setUsage] = useState<StorageUsage | null>(null);
	const [usageError, setUsageError] = useState<string | null>(null);
	const [gc, setGc] = useState<GcAnswer | null>(null);
	const [sandboxes, setSandboxes] = useState<SandboxPlan[] | null>(null);
	const [gcError, setGcError] = useState<string | null>(null);
	const [sandboxError, setSandboxError] = useState<string | null>(null);
	const [checking, setChecking] = useState(false);
	const [refresh, setRefresh] = useState(0);
	const [selected, setSelected] = useState<ReadonlySet<CleanupStep>>(new Set());
	const [confirm, setConfirm] = useState(false);
	const [run, setRun] = useState<CleanupRun | null>(null);
	const stopped = useRef(false);
	const running = useRef(false);
	const previewed = useRef(-1);
	const initialized = useRef(false);
	const stopButton = useRef<HTMLButtonElement>(null);
	const result = useRef<HTMLParagraphElement>(null);
	const busy = run?.phase === "running";
	const rows = cleanupRows(gc ?? { apply: false }, sandboxes);
	const chosen = rows.filter(row => selected.has(row.step) && row.available && row.count > 0);
	const knownBytes = chosen.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
	const cleanupLabel = knownBytes > 0 ? `Clean up about ${formatBytes(knownBytes)}` : "Clean up selected files";
	const refreshUsage = useCallback(async (): Promise<void> => {
		try {
			setUsage(await getJson<StorageUsage>(`/api/storage${cwd === null ? "" : `?cwd=${encodeURIComponent(cwd)}`}`));
			setUsageError(null);
		} catch (error) { setUsageError(errorText(error)); }
	}, [cwd]);
	useEffect(() => {
		if (active) void refreshUsage();
	}, [active, refreshUsage]);
	useEffect(() => {
		if (!active || running.current || previewed.current === refresh) return;
		previewed.current = refresh;
		setChecking(true);
		setGcError(null);
		setSandboxError(null);
		setRun(null);
		const reads = [
			putJson<{ gc: GcAnswer }>("/api/storage/cleanup", { action: "preview" }).then(answer => setGc(answer.gc), error => setGcError(errorText(error))),
			putJson<{ sandboxes: SandboxPlan[] }>("/api/storage/cleanup", { action: "preview", step: "sandboxes" }).then(answer => setSandboxes(answer.sandboxes), error => setSandboxError(errorText(error))),
		];
		void Promise.all(reads).finally(() => setChecking(false));
	}, [active, refresh]);
	useEffect(() => {
		if (!usage || initialized.current || usage.settingsError) return;
		initialized.current = true;
		const defaults = CLEANUP_STEPS.filter(step => step === "sandboxes" || usage.rules.some(row => row.id === `gc.${step}` && valueOf(row) === true));
		setSelected(new Set(defaults));
	}, [usage]);
	useEffect(() => {
		if (run?.phase === "done") result.current?.focus();
	}, [run?.phase]);
	useEffect(() => () => { stopped.current = true; }, []);
	useEffect(() => {
		if (!busy) return;
		stopButton.current?.focus();
		const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [busy]);

	const start = async (): Promise<void> => {
		if (running.current || chosen.length === 0) return;
		running.current = true;
		stopped.current = false;
		setConfirm(false);
		try { setRun(await runCleanup(chosen, sandboxes ?? [], { stopped: () => stopped.current, onProgress: setRun })); }
		finally { running.current = false; void refreshUsage(); }
	};
	const checkAgain = (): void => {
		setGc(null);
		setSandboxes(null);
		setRefresh(value => value + 1);
		void refreshUsage();
	};
	let summary = "";
	if (run?.phase === "done") {
		summary = run.stopping ? "Cleanup stopped." : "Cleanup finished.";
		if (run.after !== null) summary += ` Free space now ${formatBytes(run.after)}${run.before !== null ? `, was ${formatBytes(run.before)}` : ""}.`;
		summary += " Check again before another cleanup.";
	} else if (!checking && gc && sandboxes && rows.every(row => row.count === 0)) {
		summary = "Nothing to clean up. omp's files are already tidy.";
	}
	const kept = sandboxes?.filter(plan => plan.kept !== null) ?? [];
	return (
		<div className="space-y-10">
			<UsageSection usage={usage} error={usageError} />
			<Section
				title="Clean up"
				meta="Nothing changes until you confirm. Archive sizes and compression savings are not included in the estimate."
				actions={<Button variant="ghost" size="compact" leadingIcon={RefreshCw} loading={checking} disabled={busy} onClick={checkAgain}>Check again</Button>}
			>
				{gcError && <ErrorText>{gcError} Check again to retry.</ErrorText>}
				{sandboxError && <ErrorText>Cannot check isolation sandboxes. {sandboxError}</ErrorText>}
				<div className="divide-y divide-border">
					{rows.map(row => (
						<ChecklistRow
							key={row.step}
							row={row}
							status={run?.progress[row.step]}
							loading={row.step === "sandboxes" ? sandboxes === null && !sandboxError : gc === null && !gcError}
							finished={run?.phase === "done"}
							disabled={busy || checking || run !== null}
							checked={selected.has(row.step)}
							onCheckedChange={checked => setSelected(current => {
								const next = new Set(current);
								if (checked) next.add(row.step); else next.delete(row.step);
								return next;
							})}
						/>
					))}
				</div>
				{kept.length > 0 && (
					<details className="text-xs text-muted-foreground">
						<summary className="cursor-pointer tabular-nums">Kept ({kept.length})</summary>
						<ul className="mt-2 space-y-2">
							{kept.map(plan => <li key={plan.path}><p className="break-all">{plan.path}</p><p>{plan.detail}</p></li>)}
						</ul>
					</details>
				)}
				<p className="text-xs text-muted-foreground">
					Merged worktrees have their own review in <a href={hashForSettings("worktrees")} className={LINK}>Worktrees</a>.
				</p>
				<p ref={result} role="status" tabIndex={-1} className="text-sm tabular-nums">{summary}</p>
				<div className="flex justify-end">
					{busy ? (
						<Button
							{...activityControl("storage.stop")}
							ref={stopButton}
							variant="secondary"
							size="compact"
							disabled={run.stopping}
							onClick={() => { stopped.current = true; setRun(current => current && { ...current, stopping: true }); }}
						>
							{run.stopping ? "Stopping after this step…" : "Stop after this step"}
						</Button>
					) : (
						<Button
							variant="destructive-outline"
							size="compact"
							className="tabular-nums"
							leadingIcon={Trash2}
							disabled={checking || run !== null || !usage || !!usage.settingsError || chosen.length === 0}
							onClick={() => setConfirm(true)}
						>
							{cleanupLabel}
						</Button>
					)}
				</div>
			</Section>
			{usage && <Rules usage={usage} onRefresh={refreshUsage} onSaved={() => { onSaved(); setRefresh(value => value + 1); }} busy={busy || checking} />}
			<ConfirmDialog open={confirm} onOpenChange={setConfirm} chosen={chosen} sandboxes={sandboxes ?? []} label={cleanupLabel} onConfirm={() => void start()} />
		</div>
	);
}
