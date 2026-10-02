/** omp's own `/` and `@` completion, skills and file commands, so a dashboard prompt means what a terminal one does. */
import { autocomplete, config, extensionSettings, skills, slashCommands } from "./modules";

/** Subset of pi-tui's `AutocompleteItem` (pi-tui/src/autocomplete.ts). */
export interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}
/** pi-tui's `CombinedAutocompleteProvider`: omp's own `/` and `@` completion. */
export interface AutocompleteProvider {
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): Promise<{ items: AutocompleteItem[]; prefix: string } | null>;
	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number };
}

/** Subset of omp's `Skill` (src/extensibility/skills.ts). */
export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
}

/** Subset of omp's `FileSlashCommand` (src/extensibility/slash-commands.ts). */
export interface FileSlashCommand {
	name: string;
	description: string;
}

export const CombinedAutocompleteProvider = autocomplete.CombinedAutocompleteProvider;
export const { parseSkillInvocation, buildSkillPromptMessage } = skills;
export const { loadSlashCommands, expandSlashCommand } = slashCommands;

export interface SkillSettings {
	/** `skills.enableSkillCommands`: whether `/skill:<name>` is a command at all. */
	enableSkillCommands: boolean;
	skills: Skill[];
}

/** Skills the way an omp session in `cwd` discovers them: its settings, its disabled extensions, its project dirs. */
export async function loadSessionSkills(cwd: string): Promise<SkillSettings> {
	const settings = await config.Settings.loadReadOnly({ cwd });
	const skillSettings = extensionSettings.cfgSkills.get(settings);
	const disabledExtensions = extensionSettings.cfgDisabledExtensions.get(settings);
	const { skills: found } = await skills.loadSkills({ ...skillSettings, disabledExtensions, cwd });
	return { enableSkillCommands: skillSettings.enableSkillCommands === true, skills: found };
}
