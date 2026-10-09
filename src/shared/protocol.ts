/** The messages the dashboard socket carries between the server and the page. */
import type { Routine, RoutineChange } from "../routines";
import type { UserTodoChange, UserTodoList } from "../user-todos-shared";
import type { ModelEntry, ModelOption, PlanUsage } from "./models";
import type { Notice, NoticeOp } from "./notices";
import type { PinChange } from "./pins";
import type { Project, ProjectList } from "./projects";
import type { CompletionItem, CompletionScope, Delivery, LiveView, MessageQueue, PastSession, PromptImage, RosterHost, StartRequest, StartResult, UserAnswer, View, WithdrawnMessage } from "./sessions";
import type { AgentMedia, ChangedFile, Item } from "./transcript";

export type ServerMsg =
	/** `reset` replaces the roster with `hosts`; otherwise `hosts` replace or join by `instanceId` and `removed` leave. `error` is why the registry could not be listed, and comes with every message. */
	| { t: "roster"; reset: boolean; hosts: RosterHost[]; removed: string[]; error: string | null }
	/** `reset` replaces the list with `sessions`; otherwise `sessions` replace or join by `sessionId` and `removed` leave. The page orders them with {@link newestPastFirst}. */
	| { t: "past"; reset: boolean; sessions: PastSession[]; removed: string[] }
	/** `reset` replaces the view's transcript; otherwise `items` are upserts by id, new ids appended. */
	| { t: "items"; view: View; reset: boolean; items: Item[] }
	/** The files the view's agent changed, in first-touch order: `reset` replaces them; otherwise `files` replace or join by `path`, new paths appended. */
	| { t: "work"; view: View; reset: boolean; files: ChangedFile[] }
	/** The images the view's agent and its subagents' tools returned: `reset` replaces them; otherwise `media` joins them. The page orders them with {@link newestMediaFirst}. */
	| { t: "media"; view: View; reset: boolean; media: AgentMedia[] }
	/** Answers this socket's `start` with `reqId` once the session is ready, or once starting it failed. */
	| { t: "started"; reqId: number; result: StartResult }
	/** Answers this socket's `resume-all` with `reqId` once every session is ready or failed to start. */
	| { t: "resumed-all"; reqId: number; started: { sessionId: string; instanceId: string }[]; errors: string[] }
	/** Answers this socket's `complete` for `scope`; `reqId` counts per composer. */
	| { t: "completions"; scope: CompletionScope; reqId: number; items: CompletionItem[]; error: string | null }
	/** Plans as of the last `omp usage` run. `error` is set, and `plans` empty, when that run failed. */
	| { t: "usage"; plans: PlanUsage[]; error: string | null }
	/** Answers `list-models`. `error` is set when the session cannot list or switch models. */
	| { t: "models"; instanceId: string; models: ModelEntry[]; error: string | null }
	/** Answers this socket's `dequeue` or `interrupt` with the messages it took back, steers before follow-ups, each queue oldest first. Nothing answers when none was still waiting. */
	| { t: "withdrawn"; view: LiveView; reqId: number; messages: WithdrawnMessage[] }
	/** The Todo page's list, whole, sent when a socket opens and after every change. */
	| { t: "user-todos"; list: UserTodoList }
	/** Every routine, whole, sent when a socket opens and after every change, including each run's progress. */
	| { t: "routines"; routines: Routine[] }
	/** The directories Settings → Projects added and hid, whole, sent when a socket opens and after every change. */
	| { t: "projects"; list: ProjectList<Project> }
	/** The pinned sessions' ids, whole, sent when a socket opens and after every change. */
	| { t: "pins"; sessionIds: string[] }
	/** Every notice the bell lists, whole, sent when a socket opens and after every change. */
	| { t: "notices"; list: Notice[] }
	/** Answers this socket's message tagged `ack` once its handler settled: `error` is why it threw, `null` when it did not. */
	| { t: "done"; ack: number; error: string | null };

export type ClientMsg =
	/** The views this socket shows, replacing the last set: each new one gets its transcript, dropped ones stop streaming. */
	| { t: "watch"; views: View[] }
	/**
	 * A prompt to the session, or chat to the subagent (prompt if idle, revive if parked); `delivery` applies while a turn
	 * runs. Only the session's own agent takes `images`.
	 */
	| { t: "prompt"; view: LiveView; text: string; images: PromptImage[]; delivery: Delivery }
	/** Take one message out of the view's queue before the agent gets it, answered with `withdrawn`. `reqId` counts per view. */
	| { t: "dequeue"; reqId: number; view: LiveView; queue: keyof MessageQueue; text: string }
	/** Turn the view's queued follow-up `text` into a steer, which the running turn takes at its next step. */
	| { t: "promote"; view: LiveView; text: string }
	/** Stop the running turn and take back every message waiting on it, answered with `withdrawn`. `reqId` counts per view, shared with `dequeue`. */
	| { t: "interrupt"; reqId: number; view: LiveView }
	/** Stop the running turn while the session still holds a steer, so omp runs that steer now, as an empty Enter does in its terminal. */
	| { t: "flush"; instanceId: string }
	/** Replace user prompt `entryId` of a session this dashboard started with `text`, stopping a running turn first; the session moves to a new file. */
	| { t: "edit-prompt"; instanceId: string; entryId: string; text: string }
	/** Suggestions for the composer text with the caret at `cursor`, resolved against the scope's cwd and its skills and commands. */
	| { t: "complete"; reqId: number; scope: CompletionScope; text: string; cursor: number }
	/** End a live session: stop the omp process this dashboard started, or send SIGTERM to a terminal session's omp. */
	| { t: "end"; instanceId: string }
	/** Start a dashboard session. `reqId` counts per page and comes back with the answer. */
	| ({ t: "start"; reqId: number } & StartRequest)
	/** Resume each of these past sessions, as `start` with `resume` does. `reqId` counts per page and comes back with the answer. */
	| { t: "resume-all"; reqId: number; sessionIds: string[] }
	/** Move an interrupted session to the past sessions. */
	| { t: "dismiss-interrupted"; sessionId: string }
	/** Models a session this dashboard started can switch to. */
	| { t: "list-models"; instanceId: string }
	/** Switch a session this dashboard started to another model and, when `thinking` names one, thinking level, as picking a model role does. */
	| { t: "set-model"; instanceId: string; model: ModelOption; thinking: string | null }
	/** Switch a session this dashboard started to another thinking level, one of its `thinkingLevels`. */
	| { t: "set-thinking"; instanceId: string; level: string }
	/** Turn omp's `/fast` on or off for a session this dashboard started. */
	| { t: "set-fast"; instanceId: string; enabled: boolean }
	/** Reply to one of a live session's pending `requests`. */
	| { t: "answer"; instanceId: string; requestId: string; answer: UserAnswer }
	/** Cancel a running subagent of a live session without stopping the session's turn; it cannot be revived after. */
	| { t: "cancel-agent"; view: LiveView & { agentId: string } }
	/** Change the Todo page's list; every socket then gets the list as it is after. */
	| { t: "user-todo"; change: UserTodoChange }
	/** Change the routines, or run one now; every socket then gets the routines as they are after. */
	| { t: "routine"; change: RoutineChange }
	/** Pin or unpin sessions; every socket then gets the pins as they are after. */
	| { t: "pin"; change: PinChange }
	/** Update notices `ids`, mark them seen or read, or clear them. */
	| { t: "notice"; ids: string[]; op: NoticeOp };

/** A {@link ClientMsg} as it crosses the socket: `ack`, counted per page, asks for a `done` once the server has handled it. */
export type ClientFrame = ClientMsg & { ack?: number };
