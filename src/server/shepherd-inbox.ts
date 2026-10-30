/**
 * The requests a PR shepherd Bot's `fix_pull_request` and `queue_merge` tools (`src/omp/shepherd-extension.ts`) leave
 * for the server, one JSON file each. The server checks each against the pull request as GitHub reports it now, then
 * starts the fix's session or queues the merge; a request it refuses is done too, and the Bot hears why in its
 * conversation, so it can tell you rather than ask again.
 */
import { errorText } from "../json";
import { PULL_REQUEST_ACTIONS, pullRequestActions } from "../pull-request-actions";
import { type Bot, type BotId } from "../shared/bots";
import { prKey, type PullRequestList, type PullRequestSummary, pullRequestName, samePullRequest } from "../shared/github";
import type { MergeQueueChange } from "../shared/merge-queue";
import { type AgentOn, readyOnceChecksPass, readyToMerge } from "../shared/moves";
import { newSessionRequest, type StartRequest, type StartResult } from "../shared/sessions";
import { MAX_FIXES_PER_PULL_REQUEST, parseShepherdRequest, type ShepherdChange, type ShepherdRequest } from "../shared/shepherd";
import { SerialLane } from "../serial-lane";
import { type InboxOptions, JsonInboxDir } from "./json-inbox";

/** Why the server refuses `change` on `pr`, as GitHub reports it now, `null` when it may go ahead; `fixes` counts the starts of the same fix on it so far. */
export function shepherdRefusal(change: ShepherdChange, pr: PullRequestSummary | null, working: boolean, fixes: number): string | null {
	if (!pr) return "it is not among the open pull requests of the dashboard's workspaces";
	if (pr.role !== "author") return "you did not write it";
	if (pr.state !== "open") return pr.state === "draft" ? "it is a draft" : "it is merged";
	if (pr.review !== "approved") return "it is not approved";
	if (working) return "a session already works on it";
	switch (change.op) {
		case "fix":
			if (!pullRequestActions(pr).includes(change.action)) return `${change.action} does not apply to it now`;
			return fixes >= MAX_FIXES_PER_PULL_REQUEST ? `${change.action} already ran ${fixes} times on it` : null;
		case "merge":
			return readyToMerge(pr) || readyOnceChecksPass(pr) ? null : "it still has conflicts, failing checks, or open review threads";
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
}

export interface ShepherdDeps {
	bots(): readonly Bot[];
	/** Your pull requests as GitHub reports them now. */
	pullRequests(): Promise<PullRequestList>;
	/** Where the running sessions on each pull request stand. */
	agent(): AgentOn;
	start(request: StartRequest): Promise<StartResult>;
	queueMerge(change: Extract<MergeQueueChange, { op: "add" }>): Promise<unknown>;
	/** `null` when the pull request's head is what a reviewer approved, read in its checkout at `cwd`; else why not. */
	unapprovedChange(cwd: string, pr: PullRequestSummary): Promise<string | null>;
	/** Tells Bot `botId` something in its conversation. */
	tell(botId: BotId, text: string): Promise<unknown>;
}

export class ShepherdInbox extends JsonInboxDir<ShepherdRequest> {
	constructor(dir: string, deps: ShepherdDeps, options?: InboxOptions) {
		/** How many times each fix started on each pull request since the server started, by `<pr key>:<action>`. */
		const fixes = new Map<string, number>();
		/** One request at a time, so a second ask for the same fix sees the session the first started. */
		const lane = new SerialLane();
		super(
			dir,
			{
				parse(_name, value) {
					const request = parseShepherdRequest(value);
					if (!request) return { invalid: "it is not a PR shepherd's request" };
					const bot = deps.bots().find(({ id }) => id === request.ok.botId);
					if (!bot) return { invalid: `there is no Bot ${request.ok.botId}` };
					return bot.kind === "pr-shepherd" ? { item: request.ok } : { invalid: `Bot ${bot.id} is not a PR shepherd` };
				},
				apply: ({ botId, change }) => lane.run(async () => {
					const name = pullRequestName(change.pr);
					const verb = change.op === "fix" ? `start ${change.action} on` : "queue the merge of";
					const refuse = (why: string) => deps.tell(botId, `The dashboard did not ${verb} ${name}: ${why}.`).then(() => true);
					try {
						const list = await deps.pullRequests();
						const found = list.repos.flatMap(repo => ("error" in repo ? [] : repo.pullRequests.map(pr => ({ repo, pr })))).find(({ pr }) => samePullRequest(pr, change.pr));
						const counted = change.op === "fix" ? `${prKey(change.pr)}:${change.action}` : null;
						const why = shepherdRefusal(change, found?.pr ?? null, found ? deps.agent()(found.pr) !== null : false, counted ? (fixes.get(counted) ?? 0) : 0);
						if (why || !found) return await refuse(why ?? "it is gone");
						const cwd = found.repo.cwds[0];
						if (!cwd) return await refuse("no workspace holds its repository");
						const { pr } = found;
						if (change.op === "merge") {
							const unapproved = await deps.unapprovedChange(cwd, pr);
							if (unapproved) return await refuse(`${unapproved}; ask the user to review it again`);
							await deps.queueMerge({ op: "add", method: change.method, prs: [{ owner: pr.owner, repo: pr.repo, number: pr.number, head: null }] });
							return true;
						}
						const action = PULL_REQUEST_ACTIONS[change.action];
						const branch = action.branch(pr);
						const result = await deps.start(
							newSessionRequest(cwd, action.prompt(pr), {
								branch: branch ? { kind: "work", name: branch } : null,
								subject: { kind: "pull-request", pr: { owner: pr.owner, repo: pr.repo, number: pr.number } },
							}),
						);
						if (!result.ok) return await refuse(result.error);
						if (counted) fixes.set(counted, (fixes.get(counted) ?? 0) + 1);
						return true;
					} catch (error) {
						return await refuse(errorText(error));
					}
				}),
			},
			options,
		);
	}
}
