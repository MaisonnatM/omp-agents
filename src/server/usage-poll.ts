/**
 * `omp usage` for the status bar, the model menu, the bell's plan notices, and a continue's time. The usage tick reads it
 * and checks the plan notices while a page listens, a page that opens after a quiet tick does both at once, and a
 * continue reads it whatever the listeners without the notices.
 */
import type { ServerMsg } from "../shared/protocol";

type UsageMsg = Extract<ServerMsg, { t: "usage" }>;

export interface UsagePollDeps {
	/** Runs `omp usage` and sends every socket its report, which carries any failure in `error`. */
	refresh(): Promise<UsageMsg>;
	/** Checks the bell's plan notices against {@link UsagePoll.report}. */
	checkNotices(): Promise<void>;
}

export class UsagePoll {
	readonly #deps: UsagePollDeps;
	#report: UsageMsg | null = null;
	/** The `omp usage` run under way, which every caller shares. */
	#reading: Promise<UsageMsg> | null = null;
	/** Whether the plan notices were checked against a read since the last tick that found no listener. */
	#checked = false;

	constructor(deps: UsagePollDeps) {
		this.#deps = deps;
	}

	/** The last report, `null` before the first run ends. */
	get report(): UsageMsg | null {
		return this.#report;
	}

	/** A report read after now: a run under way may have started earlier, so this waits it out and reads again. */
	async fresh(): Promise<UsageMsg> {
		await this.#reading;
		return this.#read();
	}

	/** The usage tick: reads and checks while a page listens; otherwise the next page to open does. */
	async tick(listening: boolean): Promise<void> {
		if (listening) await this.#check();
		else this.#checked = false;
	}

	/** A page opened: it reads and checks unless that already happened since the last quiet tick. */
	async opened(): Promise<void> {
		if (!this.#checked) await this.#check();
	}

	async #check(): Promise<void> {
		await this.#read();
		await this.#deps.checkNotices();
		this.#checked = true;
	}

	#read(): Promise<UsageMsg> {
		this.#reading ??= (async () => {
			try {
				return (this.#report = await this.#deps.refresh());
			} finally {
				this.#reading = null;
			}
		})();
		return this.#reading;
	}
}
