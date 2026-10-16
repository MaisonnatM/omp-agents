/**
 * Session presets: how a new session starts, saved under a name. The server keeps them in `presets.json`, so a routine
 * starts through one with no page open, and the new-session draft fills its pickers from one.
 */
import { isNonEmpty, isObject, type Parsed } from "../json";
import type { BranchChoice } from "./git";
import type { ModelOption, ModelRole } from "./models";
import { parseModel, parseSkill, parseThinking, parseTools } from "./sessions";
import { slug } from "./slug";

/** Where a preset's session works: in the directory as it is, or on a new branch from the checked-out one, in a worktree of its own. */
export type WorktreePolicy = "here" | "new-branch";

export interface SessionPreset {
	id: string;
	name: string;
	/** `null` starts on the model omp's `default` role names. */
	model: ModelOption | null;
	/** `null` keeps the model's default level. */
	thinking: string | null;
	/** The only tools the model may call; `null` leaves every tool omp loads. */
	tools: string[] | null;
	/** The skill the first message goes through, as `/skill:<skill>`; `null` for none. */
	skill: string | null;
	worktree: WorktreePolicy;
}

/** One edit of the presets: `save` adds a preset or replaces the one of its `id`. */
export type PresetChange = { op: "save"; preset: SessionPreset } | { op: "remove"; id: string };

/** The longest preset name the page saves. */
export const MAX_PRESET_NAME = 60;

/** The tools of the starting Review preset: the ones that read the code and the web, and none that change a file or run a command. */
export const READ_ONLY_TOOLS = ["read", "grep", "glob", "find", "lsp", "ast_grep", "web_search"];

/**
 * The presets `presets.json` starts with: Minimal on the model omp's `smol` role names, with only `bash` and `edit`;
 * Review, read-only, through the thermo-nuclear review skill; and Ship, with every tool, through the mma-mode skill, on a new branch.
 */
export function starterPresets(roles: readonly ModelRole[]): SessionPreset[] {
	const smol = roles.find(role => role.role === "smol") ?? null;
	return [
		{ id: "minimal", name: "Minimal", model: smol?.model ?? null, thinking: smol?.thinking ?? null, tools: ["bash", "edit"], skill: null, worktree: "here" },
		{ id: "review", name: "Review", model: null, thinking: null, tools: READ_ONLY_TOOLS, skill: "thermo-nuclear-code-quality-review", worktree: "here" },
		{ id: "ship", name: "Ship", model: null, thinking: null, tools: null, skill: "mma-mode", worktree: "new-branch" },
	];
}

/** `presets` after `change`, or `presets` itself when it changes nothing. A new preset joins at the end. */
export function applyPresets(presets: SessionPreset[], change: PresetChange): SessionPreset[] {
	if (change.op === "remove") {
		const next = presets.filter(preset => preset.id !== change.id);
		return next.length === presets.length ? presets : next;
	}
	const { preset } = change;
	const index = presets.findIndex(candidate => candidate.id === preset.id);
	if (index < 0) return [...presets, preset];
	return JSON.stringify(presets[index]) === JSON.stringify(preset) ? presets : presets.with(index, preset);
}

/** A preset as the page sends it and `presets.json` keeps it; `null` for anything else. */
export function parsePreset(value: unknown): Parsed<SessionPreset> {
	if (!isObject(value)) return null;
	const { id, name, worktree } = value;
	const model = value.model === null ? { ok: null } : parseModel(value.model);
	const thinking = parseThinking(value.thinking);
	const tools = parseTools(value.tools);
	const skill = parseSkill(value.skill);
	if (!isNonEmpty(id) || !isNonEmpty(name) || name.length > MAX_PRESET_NAME || (worktree !== "here" && worktree !== "new-branch")) return null;
	if (!model || !thinking || !tools || !skill) return null;
	return { ok: { id, name: name.trim(), model: model.ok, thinking: thinking.ok, tools: tools.ok, skill: skill.ok, worktree } };
}

function stamp(at: Date): string {
	const two = (value: number): string => String(value).padStart(2, "0");
	return `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
}

/**
 * The branch a session started through `preset` works on, in a checkout that has `checkedOut` checked out: a new branch
 * from it named after the preset and `at`, for a `new-branch` preset; `null`, the directory as it is, otherwise or when
 * nothing is checked out.
 */
export function presetBranch(preset: Pick<SessionPreset, "name" | "worktree">, checkedOut: string | null, at: Date): BranchChoice | null {
	if (preset.worktree !== "new-branch" || checkedOut === null) return null;
	return { kind: "new", name: `${slug(preset.name, "preset")}-${stamp(at)}`, base: checkedOut };
}
