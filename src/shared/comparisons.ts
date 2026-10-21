import { isNonEmpty, isObject, type Parsed } from "../json";
import type { WorktreeBlocker } from "../worktrees-shared";
import type { ModelOption } from "./models";
import { parseImages, parseModel, parseSkill, parseThinking, type PromptImage } from "./sessions";

export type ComparisonId = string;
export type VariantId = string;
export type CleanupReviewId = string;
export type CleanupPolicy = "preserve-changes" | "discard-owned-changes";
export interface VariantSpec { model: ModelOption | null; thinking: string | null }
export interface ComparisonSpec {
	cwd: string;
	prompt: string;
	images: PromptImage[];
	base: string;
	model: ModelOption | null;
	thinking: string | null;
	skill: string | null;
	variants: VariantSpec[];
}
export type FirstPrompt = { kind: "not-attempted" } | { kind: "attempted" } | { kind: "admitted" } | { kind: "uncertain"; reason: string };
export type VariantStart = { kind: "queued" } | { kind: "starting" } | { kind: "registered" } | { kind: "failed"; error: string } | { kind: "cancelled" };
export type VariantStop = { kind: "not-requested" } | { kind: "stopping" } | { kind: "stopped" } | { kind: "blocked"; reason: string };
export type VariantCleanup = { kind: "pending" } | { kind: "preserved" } | { kind: "removed" } | { kind: "blocked"; reasons: string[] };
export interface VariantScreenshot { sequence: number; src: string; caption: string; publishedAt: number }
export interface ComparisonVariant {
	id: VariantId;
	ordinal: number;
	instanceId: string;
	sessionId: string | null;
	sessionIds: string[];
	cwd: string;
	checkout: string;
	branch: string;
	model: ModelOption | null;
	thinking: string | null;
	start: VariantStart;
	firstPrompt: FirstPrompt;
	stop: VariantStop;
	cleanup: VariantCleanup;
	screenshot: VariantScreenshot | null;
	screenshotError: string | null;
}
export interface CleanupRow {
	variantId: VariantId;
	path: string;
	branch: string;
	tracked: string[];
	untracked: string[];
	ignored: string[];
	blockers: WorktreeBlocker[];
	removed: boolean;
}
export interface CleanupReview { id: CleanupReviewId; createdAt: number; rows: CleanupRow[] }
export type CleanupRead = { kind: "not-selected" } | { kind: "stopping"; variants: VariantId[] } | { kind: "ready"; review: CleanupReview };
export type ComparisonOwner = { kind: "local" } | { kind: "other"; port: number } | { kind: "unavailable"; reason: string };
export interface ComparisonSnapshot {
	id: ComparisonId;
	createdAt: number;
	prompt: string;
	sourceCwd: string;
	repository: string;
	base: string;
	baseSha: string;
	owner: ComparisonOwner;
	variants: ComparisonVariant[];
	winner: VariantId | null;
	cleanup: CleanupRead;
	error: string | null;
}
export const isComparisonId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function parseComparisonSpec(value: unknown): Parsed<ComparisonSpec> {
	if (!isObject(value) || !isNonEmpty(value.cwd) || typeof value.prompt !== "string" || !isNonEmpty(value.base) || !Array.isArray(value.variants) || value.variants.length < 2) return null;
	const images = parseImages(value.images);
	const model = value.model == null ? { ok: null } : parseModel(value.model);
	const thinking = parseThinking(value.thinking);
	const skill = parseSkill(value.skill);
	if (!images || !model || !thinking || !skill || (!value.prompt.trim() && !images.ok.length) || value.prompt.startsWith("!")) return null;
	const variants: VariantSpec[] = [];
	for (const row of value.variants) {
		if (!isObject(row)) return null;
		const chosen = row.model == null ? { ok: null } : parseModel(row.model);
		const effort = parseThinking(row.thinking);
		if (!chosen || !effort) return null;
		variants.push({ model: chosen.ok, thinking: effort.ok });
	}
	return { ok: { cwd: value.cwd, prompt: value.prompt, base: value.base, images: images.ok, model: model.ok, thinking: thinking.ok, skill: skill.ok, variants } };
}
