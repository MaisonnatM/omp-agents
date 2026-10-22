import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { atomicWriteTextSync } from "../fs";
import { errorText } from "../json";
import { isReviewTriageState, NO_REVIEW_TRIAGES, type ReviewTriageState } from "../shared/review-triage";

export class ReviewTriagesFile {
	readonly #path: string;
	#lastGood = NO_REVIEW_TRIAGES;
	#readError: string | null = null;
	constructor(path: string) { this.#path = path; }
	get value(): ReviewTriageState {
		try { return this.read(); }
		catch (error) {
			const message = errorText(error);
			if (message !== this.#readError) console.error(`omp-agents: ${this.#path}: ${message} Showing the last good review triages; triage changes and bindings are unavailable until repair.`);
			this.#readError = message;
			return this.#lastGood;
		}
	}
	/** Strict read for mutations, tool authorization, and checkout retention. Never uses the display fallback. */
	read(): ReviewTriageState {
		let text: string;
		try { text = readFileSync(this.#path, "utf8"); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.#remember(NO_REVIEW_TRIAGES);
			throw new Error(`Cannot read review triages: ${errorText(error)}`);
		}
		let value: unknown;
		try { value = JSON.parse(text); }
		catch (error) { throw new Error(`Cannot parse review triages: ${errorText(error)}. It has not been overwritten.`); }
		if (!isReviewTriageState(value)) throw new Error("The review triage file has an invalid shape. It has not been overwritten.");
		return this.#remember(value);
	}
	update(next: (value: ReviewTriageState) => ReviewTriageState): boolean {
		const current = this.read();
		const changed = next(current);
		if (changed === current) return false;
		mkdirSync(dirname(this.#path), { recursive: true });
		atomicWriteTextSync(this.#path, `${JSON.stringify(changed, null, "\t")}\n`);
		this.#remember(changed);
		return true;
	}
	#remember(value: ReviewTriageState): ReviewTriageState {
		this.#lastGood = value;
		this.#readError = null;
		return value;
	}
}
