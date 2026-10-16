/**
 * A transcript's trajectory, which a second pass over the session file's entries groups into turns: what reached the
 * model on each turn, the calls it made, and the tokens they spent. The server folds it only while a page shows it.
 */
import { isNonEmpty, isObject, num, str } from "./json";
import { FoldedFile, ReadQueue } from "./line-reader";
import { entryTime, textOf, toolCallsOf, toolResultOf } from "./session-entries";
import { addUsage, type Clipped, NO_USAGE, type TokenUsage, type Turn, type TurnStep } from "./shared/trajectory";
import { REPLAY_BLOCK } from "./shared/replay";
import { isDashboardPrompt } from "./shared/transcript";
import { messageItemsOf } from "./transcript";

const TEXT_MAX = 16_000;
const ARGS_MAX = 4_000;

const clip = (text: string, max = TEXT_MAX): Clipped => (text.length <= max ? { text, cut: 0 } : { text: text.slice(0, max), cut: text.length - max });

function usageOf(value: unknown): TokenUsage {
	if (!isObject(value)) return NO_USAGE;
	return {
		input: num(value.input) ?? 0,
		output: num(value.output) ?? 0,
		cacheRead: num(value.cacheRead) ?? 0,
		cacheWrite: num(value.cacheWrite) ?? 0,
		cost: (isObject(value.cost) ? num(value.cost.total) : undefined) ?? 0,
	};
}

const attributionOf = (value: unknown): "user" | "agent" | null => (value === "user" || value === "agent" ? value : null);

type ToolStep = Extract<TurnStep, { kind: "tool" }>;

/**
 * Turns, each opened by an entry the transcript shows as a prompt, so the trajectory has as many turns as the
 * transcript's outline. What reaches the model between requests waits: the next request puts it in the current turn,
 * and the next prompt leads its own turn with it.
 */
export class Trajectory {
	#turns: Turn[] = [];
	#waiting: TurnStep[] = [];
	#tools = new Map<string, { step: ToolStep; turn: Turn }>();
	/** When omp started each tool call, in ms, from its `tool_execution_start` marker. */
	#started = new Map<string, number>();
	#changed = new Set<Turn>();
	constructor(readonly detail = false) {}

	turns(): Turn[] {
		return this.#turns;
	}

	/** The turns the entries applied since the last call touched, in order. */
	takeChanged(): Turn[] {
		const changed = [...this.#changed];
		this.#changed.clear();
		return changed;
	}

	applyEntry(entry: unknown): void {
		if (!isObject(entry)) return;
		switch (entry.type) {
			case "message":
				if (isObject(entry.message)) this.#message(entry, entry.message);
				return;
			case "custom_message":
				this.#customMessage(entry);
				return;
			case "custom":
				if (entry.customType === REPLAY_BLOCK && isObject(entry.data)) {
					const call = this.#tools.get(String(entry.data.toolCallId));
					if (call) {
						call.step.blocked = true;
						this.#changed.add(call.turn);
					}
				}
				if (entry.customType === "tool_execution_start" && isObject(entry.data)) {
					const callId = str(entry.data.toolCallId);
					const at = Date.parse(str(entry.data.startedAt) ?? "");
					if (callId !== undefined && Number.isFinite(at)) this.#started.set(callId, at);
				}
				return;
			case "model_usage":
				this.#waiting.push({ kind: "side-call", purpose: str(entry.purpose) ?? "", model: str(entry.model) ?? "", usage: usageOf(entry.usage) });
				return;
			case "model_change":
				this.#waiting.push({ kind: "model", model: str(entry.model) ?? "", role: str(entry.role) ?? null });
				return;
			case "thinking_level_change":
				this.#waiting.push({ kind: "thinking-level", level: str(entry.thinkingLevel) ?? "off" });
				return;
			case "compaction":
				this.#waiting.push({ kind: "compaction", tokensBefore: num(entry.tokensBefore) ?? null });
				return;
			case "ttsr_injection": {
				const rules = Array.isArray(entry.injectedRules) ? entry.injectedRules.filter(rule => typeof rule === "string") : [];
				this.#waiting.push({ kind: "injection", source: "ttsr", attribution: null, body: clip(rules.join(", ")) });
				return;
			}
			case "branch_summary":
				this.#waiting.push({ kind: "injection", source: "branch-summary", attribution: null, body: clip(str(entry.summary) ?? "") });
				return;
		}
	}

	#message(entry: Record<string, unknown>, message: Record<string, unknown>): void {
		switch (message.role) {
			case "user":
			case "bashExecution":
				if (!this.#opens(entry)) {
					const text = textOf(message.content);
					const source = message.synthetic === true ? "synthetic" : message.role === "user" && isDashboardPrompt(text) ? "omp-agents" : String(message.role);
					this.#waiting.push({ kind: "injection", source, attribution: attributionOf(message.attribution), body: clip(text) });
				}
				return;
			case "developer":
				this.#waiting.push({ kind: "injection", source: "developer", attribution: attributionOf(message.attribution), body: clip(textOf(message.content)) });
				return;
			case "assistant":
				this.#request(message);
				return;
			case "toolResult":
				this.#toolResult(entry, message);
				return;
		}
	}

	#customMessage(entry: Record<string, unknown>): void {
		const opened = this.#opens(entry);
		const injection: TurnStep = { kind: "injection", source: str(entry.customType) ?? "", attribution: attributionOf(entry.attribution), body: clip(textOf(entry.content)) };
		if (opened) this.#push(opened, injection);
		else this.#waiting.push(injection);
	}

	/** Opens a turn when the transcript shows `entry` as a prompt, and returns it. */
	#opens(entry: Record<string, unknown>): Turn | null {
		const prompt = messageItemsOf(entry).find(item => item.kind === "user");
		if (!prompt) return null;
		const turn: Turn = {
			id: str(entry.id) ?? `turn-${this.#turns.length + 1}`,
			index: this.#turns.length + 1,
			at: entryTime(entry),
			steps: [],
			usage: NO_USAGE,
			requests: 0,
			toolCalls: 0,
		};
		this.#turns.push(turn);
		this.#flush(turn);
		this.#push(turn, { kind: "prompt", body: clip(prompt.text, this.detail ? Infinity : TEXT_MAX), skill: prompt.skill });
		return turn;
	}

	#current(): Turn {
		const last = this.#turns.at(-1);
		if (last) return last;
		const turn: Turn = { id: "start", index: 1, at: null, steps: [], usage: NO_USAGE, requests: 0, toolCalls: 0 };
		this.#turns.push(turn);
		return turn;
	}

	#flush(turn: Turn): void {
		for (const step of this.#waiting) this.#push(turn, step);
		this.#waiting = [];
	}

	#push(turn: Turn, step: TurnStep): void {
		turn.steps.push(step);
		if (step.kind === "request" || step.kind === "side-call") turn.usage = addUsage(turn.usage, step.usage);
		if (step.kind === "request") turn.requests++;
		if (step.kind === "tool") turn.toolCalls++;
		this.#changed.add(turn);
	}

	#request(message: Record<string, unknown>): void {
		const turn = this.#current();
		this.#flush(turn);
		this.#push(turn, {
			kind: "request",
			model: str(message.model) ?? "",
			usage: usageOf(message.usage),
			stopReason: str(message.stopReason) ?? "",
			durationMs: num(message.duration) ?? null,
		});
		const calls = new Map(toolCallsOf(message).map(call => [call.id, call]));
		if (!Array.isArray(message.content)) return;
		for (const block of message.content) {
			if (!isObject(block)) continue;
			if (block.type === "thinking" && isNonEmpty(block.thinking)) this.#push(turn, { kind: "thinking", body: clip(block.thinking, this.detail ? Infinity : TEXT_MAX) });
			else if (block.type === "text" && isNonEmpty(block.text)) this.#push(turn, { kind: "reply", body: clip(block.text, this.detail ? Infinity : TEXT_MAX) });
			else if (block.type === "toolCall") {
				const call = calls.get(str(block.id) ?? "");
				if (!call) continue;
				const step: ToolStep = {
					kind: "tool",
					callId: call.id,
					name: call.name,
					args: clip(JSON.stringify(call.args ?? {}, null, 2), this.detail ? Infinity : ARGS_MAX),
					status: "running",
					resultBytes: null,
					resultImages: 0,
					durationMs: null,
				};
				this.#push(turn, step);
				this.#tools.set(call.id, { step, turn });
			}
		}
	}

	#toolResult(entry: Record<string, unknown>, message: Record<string, unknown>): void {
		const result = toolResultOf(message);
		const call = result?.callId === undefined ? undefined : this.#tools.get(result.callId);
		if (!result || !call) return;
		const started = this.#started.get(call.step.callId);
		const ended = entryTime(entry);
		call.step.status = result.isError ? "error" : "ok";
		call.step.resultBytes = Buffer.byteLength(textOf(result.content));
		if (this.detail) call.step.result = clip(textOf(result.content), Infinity);
		call.step.resultImages = Array.isArray(result.content) ? result.content.filter(block => isObject(block) && block.type === "image").length : 0;
		call.step.durationMs = started !== undefined && ended !== null ? Math.max(0, ended - started) : null;
		this.#changed.add(call.turn);
	}
}

class TrajectoryFold {
	readonly trajectory = new Trajectory();

	applyLine(line: string): void {
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			return;
		}
		this.trajectory.applyEntry(entry);
	}
}

/** Publishes the turns of one transcript file: all of them once the first read finishes, then the turns each later read touched. */
export class TrajectoryTail {
	readonly path: string;
	readonly #file: FoldedFile<TrajectoryFold>;
	readonly #reads = new ReadQueue(() => this.#read());
	readonly #emit: (reset: boolean, turns: Turn[]) => void;
	#loaded = false;
	#closed = false;

	constructor(path: string, emit: (reset: boolean, turns: Turn[]) => void) {
		this.path = path;
		this.#file = new FoldedFile(path, () => new TrajectoryFold());
		this.#emit = emit;
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	turns(): Turn[] {
		return this.#file.fold.trajectory.turns();
	}

	poke(): void {
		if (!this.#closed) this.#reads.poke();
	}

	close(): void {
		this.#closed = true;
	}

	async #read(): Promise<void> {
		const { readable, restarted } = await this.#file.read();
		if (restarted) this.#loaded = false;
		if (!readable || this.#closed) return;
		const changed = this.#file.fold.trajectory.takeChanged();
		if (!this.#loaded) {
			this.#loaded = true;
			this.#emit(true, this.turns());
		} else if (changed.length > 0) {
			this.#emit(false, changed);
		}
	}
}
