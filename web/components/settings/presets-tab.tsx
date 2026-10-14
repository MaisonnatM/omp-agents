import { Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_PRESET_NAME, parsePreset, type PresetChange, type SessionPreset, type WorktreePolicy } from "../../../src/shared/presets";
import { errorText } from "../../api";
import { useRead } from "../../reads";
import { useDraftModelSelection } from "../../use-draft-model";
import { useSkills } from "../../use-skills";
import { useDashboardActions } from "../dashboard-context";
import { IntegrationList } from "../integrations/integration-row";
import { ModelPicker } from "../model-picker";
import { presetSummary } from "../preset-picker";
import { SkillPicker } from "../skill-picker";
import { Section } from "./editor";

const FIELD = "block h-7 w-80 max-w-full rounded-md border border-border bg-transparent px-2 text-sm";

const WORKTREES: Record<WorktreePolicy, string> = {
	here: "In the directory as it is",
	"new-branch": "On a new branch from the checked-out one, in its own worktree",
};

interface PresetEditorProps {
	initial: SessionPreset;
	cwd: string;
	onSave: (preset: SessionPreset) => Promise<boolean>;
	onCancel: () => void;
}

function PresetEditor({ initial, cwd, onSave, onCancel }: PresetEditorProps) {
	const id = useId();
	const [name, setName] = useState(initial.name);
	const models = useDraftModelSelection(cwd, initial);
	const builtin = useRead<{ tools: string[] }>("/api/tools");
	const builtinNames = builtin.data?.tools ?? [];
	const [limited, setLimited] = useState(initial.tools !== null);
	const [checked, setChecked] = useState(initial.tools ?? []);
	const skills = useSkills(cwd);
	const [skill, setSkill] = useState(initial.skill);
	const [worktree, setWorktree] = useState(initial.worktree);
	const [saving, setSaving] = useState(false);
	const [fix, setFix] = useState<string | null>(null);
	const toggle = (tool: string): void => setChecked(current => (current.includes(tool) ? current.filter(item => item !== tool) : [...current, tool]));
	const tools = limited ? checked : null;
	const submit = async (event: FormEvent): Promise<void> => {
		event.preventDefault();
		if (!name.trim()) return setFix("Name the preset.");
		if (tools?.length === 0) return setFix("Pick at least one tool, or allow every tool.");
		const parsed = parsePreset({ id: initial.id, name, model: models.model, thinking: models.thinking, tools, skill, worktree });
		if (!parsed) return setFix("The preset contains an invalid model, thinking level, tool list, or skill.");
		setFix(null);
		setSaving(true);
		if (!(await onSave(parsed.ok))) setSaving(false);
	};
	return (
		<form className="space-y-4 rounded-md border border-border p-4" onSubmit={submit}>
			<label className="space-y-1 text-sm">
				Name
				<input value={name} maxLength={MAX_PRESET_NAME} autoFocus onChange={event => setName(event.target.value)} placeholder="Review" className={FIELD} />
			</label>
			<div className="space-y-1 text-sm">
				<p>Model and thinking</p>
				<ModelPicker {...models.picker} />
			</div>
			<fieldset className="space-y-2 text-sm">
				<legend>Tools</legend>
				<label className="flex items-center gap-2">
					<input type="radio" name={`${id}-tools`} checked={!limited} onChange={() => setLimited(false)} className="size-4 accent-current" />
					Every tool omp loads
				</label>
				<label className="flex items-center gap-2">
					<input type="radio" name={`${id}-tools`} checked={limited} onChange={() => setLimited(true)} className="size-4 accent-current" />
					Only these built-in tools
				</label>
				{limited && (
					<div className="ml-6 space-y-2">
						{builtin.error && <p className="text-xs text-red-600 dark:text-red-400">Cannot list omp's tools: {builtin.error}</p>}
						<div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-1">
							{builtinNames.map(tool => (
								<label key={tool} className="flex items-center gap-2 font-mono text-xs">
									<input type="checkbox" checked={checked.includes(tool)} onChange={() => toggle(tool)} className="size-4 accent-current" />
									{tool}
								</label>
							))}
						</div>
						<p className="text-xs text-muted-foreground">Restricted sessions do not load MCP servers or extension tools.</p>
					</div>
				)}
			</fieldset>
			<div className="space-y-1 text-sm">
				<p>Skill</p>
				<SkillPicker label="Preset skill" skills={skills} value={skill} onPick={setSkill} />
			</div>
			<fieldset className="space-y-2 text-sm">
				<legend>Where the session works</legend>
				{(Object.keys(WORKTREES) as WorktreePolicy[]).map(policy => (
					<label key={policy} className="flex items-center gap-2">
						<input type="radio" name={`${id}-worktree`} checked={worktree === policy} onChange={() => setWorktree(policy)} className="size-4 accent-current" />
						{WORKTREES[policy]}
					</label>
				))}
			</fieldset>
			<div className="flex items-center gap-3">
				<Button type="submit" size="compact" loading={saving} disabled={saving || models.levels === null}>
					Save preset
				</Button>
				<Button type="button" variant="ghost" size="compact" onClick={onCancel}>
					Cancel
				</Button>
				{fix && (
					<p role="alert" className="text-xs text-red-600 dark:text-red-400">
						{fix}
					</p>
				)}
			</div>
		</form>
	);
}

interface PresetsTabProps {
	presets: SessionPreset[];
	/** The directory whose models and skills the editor offers. */
	cwd: string;
	connected: boolean;
}

/** The saved presets, each with what it starts with, an editor for one, and a button to add one. */
export function PresetsTab({ presets, cwd, connected }: PresetsTabProps) {
	const { request } = useDashboardActions();
	const [editing, setEditing] = useState<SessionPreset | null>(null);
	const [error, setError] = useState<string | null>(null);
	const change = async (next: PresetChange): Promise<boolean> => {
		setError(null);
		try {
			await request({ t: "preset", change: next });
			return true;
		} catch (err) {
			setError(errorText(err));
			return false;
		}
	};
	const blank = (): SessionPreset => ({ id: crypto.randomUUID(), name: "", model: null, thinking: null, tools: null, skill: null, worktree: "here" });
	return (
		<Section
			title="Session presets"
			meta="What a new session or a routine starts with: a model and thinking level, the only tools the model may call, a skill, and where it works."
			actions={
				!editing && (
					<Button variant="secondary" size="compact" leadingIcon={Plus} disabled={!connected} onClick={() => setEditing(blank())}>
						New preset
					</Button>
				)
			}
		>
			{error && (
				<p role="alert" className="text-xs text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
			{editing && (
				<PresetEditor
					key={editing.id}
					initial={editing}
					cwd={cwd}
					onCancel={() => setEditing(null)}
					onSave={async preset => {
						const saved = await change({ op: "save", preset });
						if (saved) setEditing(null);
						return saved;
					}}
				/>
			)}
			{presets.length === 0 ? (
				<p className="text-sm text-muted-foreground">No presets yet.</p>
			) : (
				<IntegrationList label="Session presets">
					{presets.map(preset => (
						<li key={preset.id} className="flex items-center gap-3 px-4 py-2.5">
							<div className="min-w-0 flex-1">
								<p className="truncate text-[13px] font-medium">{preset.name}</p>
								<p className="truncate text-xs text-muted-foreground">{presetSummary(preset)}</p>
							</div>
							<Button variant="ghost" size="compact" leadingIcon={Pencil} disabled={!connected || editing !== null} onClick={() => setEditing(preset)}>
								Edit
							</Button>
							<Button variant="ghost" size="compact" leadingIcon={Trash2} disabled={!connected} onClick={() => void change({ op: "remove", id: preset.id })}>
								Remove
							</Button>
						</li>
					))}
				</IntegrationList>
			)}
		</Section>
	);
}
