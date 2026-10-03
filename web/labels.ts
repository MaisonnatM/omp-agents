/** Names the page gives things: sessions, models, providers, file kinds, and the click gestures that open rows. */
import type { MouseEvent } from "react";
import type { CatalogModel, OmpFile, OmpFileKind, PastSession, PullRequest, RosterHost } from "../src/shared";
import { IS_MAC } from "./shortcuts";
import type { OpenMode } from "./routing";

/** Settings page file groups, in the order the page lists them. */
export const FILE_KIND_LABELS: Record<OmpFileKind, string> = {
	context: "Context",
	"system-prompt": "System prompt",
	"append-system": "Appended system prompt",
	settings: "Settings",
	agent: "Agents",
	command: "Commands",
	rule: "Rules",
	skill: "Skills",
	hook: "Hooks",
};

/** Files by kind in {@link FILE_KIND_LABELS} order, user files before project files; kinds without files left out. */
export function fileGroups(files: OmpFile[]): [OmpFileKind, OmpFile[]][] {
	return (Object.keys(FILE_KIND_LABELS) as OmpFileKind[]).flatMap((kind): [OmpFileKind, OmpFile[]][] => {
		const group = files.filter(file => file.kind === kind).toSorted((a, b) => (a.scope === b.scope ? 0 : a.scope === "user" ? -1 : 1));
		return group.length ? [[kind, group]] : [];
	});
}

/** Words that keep their own casing in a label. */
const BRAND_WORDS: Record<string, string> = {
	deepseek: "DeepSeek",
	glm: "GLM",
	gpt: "GPT",
	minimax: "MiniMax",
	moonshotai: "Moonshot AI",
	openai: "OpenAI",
	openrouter: "OpenRouter",
	oss: "OSS",
	xai: "xAI",
};

function labelWord(word: string): string {
	const brand = BRAND_WORDS[word.toLowerCase()];
	if (brand) return brand;
	// Sizes such as a `1m` context, `31b` parameters, or `a3b` active ones.
	if (/^a?\d+(\.\d+)?[bkm]$/i.test(word)) return word.toUpperCase();
	// Versions such as `4o`, and OpenAI's lowercase `o3`.
	if (/^(\d|o\d)/.test(word)) return word;
	return word[0].toUpperCase() + word.slice(1);
}

const labelWords = (words: string[]): string => words.filter(Boolean).map(labelWord).join(" ");

/** A provider id as its name: `openai-codex` reads `OpenAI Codex`. */
export const providerLabel = (provider: string): string => labelWords(provider.split("-"));

/** A skill name as its title: `poteto-mode` reads `Poteto Mode`. */
export const skillLabel = (name: string): string => labelWords(name.split(/[-_\s]+/));

/**
 * A model selector as people name the model, leaving its provider and org to the logo: `anthropic/claude-opus-5-5`
 * reads `Opus 5.5`. A `:suffix`, such as a thinking level or a router's `batch` tier, follows in parentheses.
 */
export function modelLabel(selector: string): string {
	const id = selector.slice(selector.lastIndexOf("/") + 1);
	const colon = id.indexOf(":");
	const name = (colon < 0 ? id : id.slice(0, colon))
		// Anthropic's older ids put the version first: `claude-3-5-sonnet` is Sonnet 3.5.
		.replace(/^claude-(?:([\d.-]*\d)-([a-z]+))?/, (_, version?: string, family?: string) => (version ? `${family}-${version}` : ""))
		.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, "");
	const words: string[] = [];
	for (const word of name.split("-")) {
		const last = words.at(-1);
		// `5-5` is version 5.5 and `4-0` plain 4; longer numbers such as `gpt-4-1106` are builds, not minor versions.
		if (last !== undefined && /^\d{1,2}$/.test(last) && /^\d{1,2}$/.test(word)) {
			if (word !== "0") words[words.length - 1] = `${last}.${word}`;
		} else words.push(word);
	}
	const label = labelWords(words).replace(/^GPT (?=\d)/, "GPT-");
	return colon < 0 ? label : `${label} (${id.slice(colon + 1)})`;
}

/**
 * A selector as the model `omp models` lists and its `:level` thinking suffix. Model ids can hold colons
 * (`minimax-m3:batch`), so the suffix splits off only when the rest is a listed model and the whole is not.
 */
export function splitSelector(selector: string, models: ReadonlyMap<string, CatalogModel>): { model: string; level: string | null } {
	const colon = selector.lastIndexOf(":");
	if (colon < 0 || models.has(selector) || !models.has(selector.slice(0, colon))) return { model: selector, level: null };
	return { model: selector.slice(0, colon), level: selector.slice(colon + 1) };
}

/** Providers whose id is not the org that makes their models. */
const PROVIDER_ORGS: Record<string, string> = { "openai-codex": "openai" };

export const providerOrg = (provider: string): string => PROVIDER_ORGS[provider] ?? provider;

/** Model families that resellers such as Cursor serve under their own provider id. */
const FAMILY_ORGS: [RegExp, string][] = [
	[/^claude/, "anthropic"],
	[/^(gpt|o\d|codex)/, "openai"],
	[/^deepseek/, "deepseek"],
	[/^kimi/, "moonshotai"],
];

/** The org that makes a `provider/id` model: a router's `org/model` id names it, else the model family, else the provider. */
export function modelOrg(selector: string): string {
	const slash = selector.indexOf("/");
	const provider = selector.slice(0, slash);
	const id = selector.slice(slash + 1);
	const routed = id.indexOf("/");
	if (routed >= 0) return id.slice(0, routed).replace(/^~/, "");
	return FAMILY_ORGS.find(([family]) => family.test(id))?.[1] ?? providerOrg(provider);
}

/** ⌘-click on macOS, where Ctrl-click opens the context menu, and Ctrl-click elsewhere, opens a row in a new pane. */
export const modeOf = (event: MouseEvent): OpenMode => ((IS_MAC ? event.metaKey : event.ctrlKey) ? "split" : "replace");

/** The gesture {@link modeOf} reads as a split, as hints name it. */
export const SPLIT_CLICK = IS_MAC ? "⌘-click" : "Ctrl-click";

export function age(startedAt: number): string {
	const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
	if (minutes < 60) return `${minutes}m`;
	if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	return `${Math.floor(minutes / 1440)}d`;
}

/** A sidebar row's pull requests: the first one's number, then `+N` for the rest, which the row's tooltip and menu list. */
export const pullRequestsLabel = ([first, ...rest]: PullRequest[]): string => (rest.length ? `#${first.number} +${rest.length}` : `#${first.number}`);

/** When a page last read its data: the time alone today, else the date and time. */
export const readTime = (at: number): string =>
	new Date(at).toDateString() === new Date().toDateString() ? new Date(at).toLocaleTimeString() : new Date(at).toLocaleString();

/** The project a directory holds, its last segment: `~/code/webapp` reads `webapp`. */
export const projectName = (cwdDisplay: string): string | undefined => cwdDisplay.split("/").filter(Boolean).pop();

export const hostLabel = (host: RosterHost): string => host.sessionName ?? projectName(host.cwdDisplay) ?? host.cwdDisplay;

export const pastLabel = (session: PastSession): string => session.title ?? projectName(session.cwdDisplay) ?? "Untitled session";
