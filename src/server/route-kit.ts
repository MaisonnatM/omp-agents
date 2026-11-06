/** The route kit and the session routes' env. Route groups import these, and `routes.ts` imports the groups, so the types cannot live in `routes.ts`. */
import type { Server } from "bun";
import type { SessionSummary } from "../analytics";
import type { SessionPlace } from "../changes";
import type { FileUsage } from "../foreign/usage";
import type { PullRequest, Repo } from "../shared/github";
import type { TrustChange } from "../shared/project-trust";
import type { ConversationHit } from "../shared/sessions";
import type { SourceControlAnswer, SourceControlChange } from "../shared/source-control";
import type { WorkspaceChange } from "../shared/workspaces";
import { answer, type Guards } from "./http";

/** What the session routes read: the workspaces sessions count in, their files, and the workspaces Settings keeps. */
export interface SessionRoutesEnv {
	/** The workspaces sessions count in: live ones first, then saved ones newest first. */
	knownWorkspaces(): string[];
	/** The directories Settings → Workspaces added, which the page names as workspaces before any session runs there. */
	addedCwds(): string[];
	/** Apply `change` to the workspaces and send every socket the workspaces after it. */
	changeWorkspaces(change: WorkspaceChange): void;
	/** Apply `change` to the trusted project code and send every socket the trusted projects after it. */
	changeProjectTrust(change: TrustChange): void;
	/** The listed file of a session, for Analytics' title, the workspace it counts in, and one session's usage. */
	summaryOf(sessionId: string): SessionSummary | null;
	/** The requests Claude Code's and Codex's transcripts record, each transcript read past what earlier reads folded. */
	foreignUsage(): Promise<FileUsage[]>;
	/** Where session `sessionId` works, for its changes; `null` while its file is not listed. */
	placeOf(sessionId: string): SessionPlace | null;
	/** The pull request list loaded `repo`'s pull requests, which tells which branch heads which PR and so links the sessions that pushed them. */
	learnHeads(repo: Repo, pullRequests: readonly (PullRequest & { head: string })[]): void;
	/** The saved conversations whose prompts or replies hold every word of `query`, the file changed last first. */
	searchConversations(query: string): Promise<ConversationHit[]>;
	sourceControl(): Promise<SourceControlAnswer>;
	/** Apply `change` to the source control settings, and pull again when it changed the automatic pulls. */
	changeSourceControl(change: SourceControlChange): void;
}

/** A route's handler; Bun passes its server, whose `timeout` lifts a slow request's idle timeout. */
export type Handler = (req: Request, server: Pick<Server<unknown>, "timeout">) => Promise<Response>;
/** HTTP handlers by path and method, as `Bun.serve` takes them. */
export type Routes = Record<string, Partial<Record<"GET" | "PUT", Handler>>>;

/** The ways a route answers: a read of its query, a read that a tag loads, and a write of its JSON body. */
export interface RouteKit {
	/** A read: admitted like every other, then handed the request's query. */
	get(handle: (params: URLSearchParams, req: Request) => Response | Promise<Response>): Handler;
	/** `get` for a file that an image, a video, or a frame loads, which sends no header: it also takes the media key as `?key=`. */
	media(handle: (params: URLSearchParams, req: Request) => Response | Promise<Response>): Handler;
	/**
	 * A write: admitted with its JSON body (origin, content type, size), `parse`d with the request's query into an input or the
	 * response refusing it, then `run`, whose result is the answer's JSON, unless it is a `Response`; `refuse` answers an error
	 * `run` throws, and any other is a 500 with its text.
	 */
	write<T>(
		parse: (body: unknown, params: URLSearchParams) => T | Response | Promise<T | Response>,
		run: (input: T) => Promise<unknown>,
		refuse?: (err: unknown) => Response | null,
	): Handler;
}

export function routeKit(guards: Guards): RouteKit {
	return {
		get: (handle) => async (req) => guards.admit(req) ?? handle(new URL(req.url).searchParams, req),
		media: (handle) => async (req) => guards.admitMedia(req) ?? handle(new URL(req.url).searchParams, req),
		write: (parse, run, refuse) => async (req) => {
			const guarded = await guards.writeBody(req);
			if (guarded instanceof Response) return guarded;
			const input = await parse(guarded.body, new URL(req.url).searchParams);
			return input instanceof Response ? input : answer(() => run(input), refuse);
		},
	};
}
