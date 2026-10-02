import { CircleCheck, CircleDashed, CircleSlash, CircleX, ExternalLink, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { CheckRunState, PullRequest, PullRequestCheck, PullRequestComment, PullRequestDetail, PullRequestEvent } from "../../../src/shared";
import { SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { graphiteUrl, pullRequestUrl } from "../../inbox-model";
import { age } from "../../labels";
import { usePullRequest } from "../../use-pull-request";
import { MessageMarkdown } from "../message-markdown";
import { Avatar, IconTip, STATE_ICON } from "./avatars";

const CHECK_RUN_ICON: Record<CheckRunState, [LucideIcon, string]> = {
	passing: [CircleCheck, "text-emerald-600 dark:text-emerald-400"],
	failing: [CircleX, "text-red-600 dark:text-red-400"],
	pending: [CircleDashed, "text-amber-600 dark:text-amber-400"],
	skipped: [CircleSlash, "text-muted-foreground"],
};

/** What a comment or review did, after its author's name. */
const EVENT_ACTION: Record<NonNullable<PullRequestEvent["review"]> | "comment", string> = {
	approved: "approved",
	"changes-requested": "requested changes",
	commented: "reviewed",
	dismissed: "reviewed, since dismissed",
	comment: "commented",
};

/** A titled part of a pull request's details. */
function DetailSection({ title, children }: { title: ReactNode; children: ReactNode }) {
	return (
		<section className="space-y-2">
			<h5 className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">{title}</h5>
			{children}
		</section>
	);
}

/** An external link that says where it goes. */
function OutLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline">
			{children}
			<ExternalLink aria-hidden className="size-3" />
		</a>
	);
}

function Comment({ comment: { author, body, at, url }, action }: { comment: PullRequestComment; action: string }) {
	const when = `${age(at)} ago`;
	return (
		<li className="space-y-1.5">
			<p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
				<Avatar person={author} label={author.login} className="mr-0.5" />
				<span className="font-medium text-foreground">{author.login}</span>
				{action}
				<span title={new Date(at).toLocaleString()}>{url ? <OutLink href={url}>{when}</OutLink> : when}</span>
			</p>
			{body.trim() && (
				<div className="pl-7 text-sm [&_img]:max-w-full">
					<MessageMarkdown text={body} github />
				</div>
			)}
		</li>
	);
}

function CheckRow({ check: { name, state, url } }: { check: PullRequestCheck }) {
	const [Icon, color] = CHECK_RUN_ICON[state];
	return (
		<li className="flex min-w-0 items-center gap-2">
			<Icon aria-label={state} className={cn("size-3.5 shrink-0", color)} />
			{url ? (
				<a href={url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
					{name}
				</a>
			) : (
				<span className="truncate">{name}</span>
			)}
		</li>
	);
}

/** Failing and pending checks in full; passing and skipped ones folded behind their counts. */
function Checks({ checks }: { checks: PullRequestCheck[] }) {
	const waiting = checks.filter(check => check.state === "failing" || check.state === "pending");
	const settled = checks.filter(check => check.state === "passing" || check.state === "skipped");
	const passing = settled.filter(check => check.state === "passing").length;
	const skipped = settled.length - passing;
	return (
		<div className="space-y-1.5 text-xs">
			{waiting.length > 0 && (
				<ul className="space-y-1">
					{waiting.map((check, index) => (
						// GitHub can name two runs alike.
						<CheckRow key={index} check={check} />
					))}
				</ul>
			)}
			{settled.length > 0 && (
				<details>
					<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
						{[passing > 0 && `${passing} passing`, skipped > 0 && `${skipped} skipped`].filter(Boolean).join(", ")}
					</summary>
					<ul className="mt-1.5 space-y-1">
						{settled.map((check, index) => (
							<CheckRow key={index} check={check} />
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

/** A pull request read from GitHub, as the inbox's sheet shows it: a header that names it, with `actions` below, then its details. */
export function PullRequestSheetContent({ pr, actions }: { pr: PullRequest; actions?: ReactNode }) {
	const { detail, error } = usePullRequest(pr);
	const name = `${pr.owner}/${pr.repo}#${pr.number}`;
	let body: ReactNode = <p className="text-sm text-muted-foreground">Asking GitHub for the pull request…</p>;
	if (detail) body = <PullRequestSections detail={detail} />;
	else if (error) {
		body = (
			<p role="alert" className="text-sm text-red-600 dark:text-red-400">
				Cannot load the pull request: {error}
			</p>
		);
	}
	return (
		<>
			<header className="space-y-1.5 border-b border-border py-3 pr-12 pl-5">
				<SheetTitle className="flex items-start gap-2.5 text-base leading-snug font-semibold">
					{detail && <IconTip icon={STATE_ICON[detail.state]} className="mt-1" />}
					<span className="min-w-0">{detail?.title ?? name}</span>
				</SheetTitle>
				<p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					<span className="tabular-nums">{name}</span>
					{detail && (
						<>
							<span className="min-w-0 truncate">
								<span className="font-mono">{detail.head}</span> into <span className="font-mono">{detail.base}</span>
							</span>
							<span className="tabular-nums">
								<span className="text-emerald-600 dark:text-emerald-400">+{detail.additions}</span>{" "}
								<span className="text-red-600 dark:text-red-400">−{detail.deletions}</span> in {detail.changedFiles}{" "}
								{detail.changedFiles === 1 ? "file" : "files"}
							</span>
							<span title={new Date(detail.createdAt).toLocaleString()}>
								opened by {detail.author.login} {age(detail.createdAt)} ago
							</span>
						</>
					)}
					<span className="ml-auto flex gap-3">
						<OutLink href={pullRequestUrl(pr)}>GitHub</OutLink>
						<OutLink href={graphiteUrl(pr)}>Graphite</OutLink>
					</span>
				</p>
				{actions}
			</header>
			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">{body}</div>
		</>
	);
}

/** A pull request's description, checks, unresolved comments, conversation, and files. */
function PullRequestSections({ detail }: { detail: PullRequestDetail }) {
	const { body, checks, threads, conversation, files } = detail;
	return (
		<>
			<DetailSection title="Description">
				{body.trim() ? (
					<div className="text-sm [&_img]:max-w-full">
						<MessageMarkdown text={body} github />
					</div>
				) : (
					<p className="text-sm text-muted-foreground">No description.</p>
				)}
			</DetailSection>
			{checks.length > 0 && (
				<DetailSection title="Checks">
					<Checks checks={checks} />
				</DetailSection>
			)}
			{threads.length > 0 && (
				<DetailSection
					title={
						<>
							Unresolved comments <span className="tabular-nums">{threads.length}</span>
						</>
					}
				>
					<ul className="space-y-3">
						{threads.map((thread, index) => (
							<li key={index} className="space-y-3 rounded-md border border-border p-3">
								<p className="truncate font-mono text-xs text-muted-foreground" title={thread.path}>
									{thread.path}
									{thread.line !== null && `:${thread.line}`}
								</p>
								<ul className="space-y-3">
									{thread.comments.map((comment, at) => (
										<Comment key={at} comment={comment} action={at === 0 ? "commented" : "replied"} />
									))}
								</ul>
							</li>
						))}
					</ul>
				</DetailSection>
			)}
			{conversation.length > 0 && (
				<DetailSection title="Conversation">
					<ul className="space-y-4">
						{conversation.map((event, index) => (
							<Comment key={index} comment={event} action={EVENT_ACTION[event.review ?? "comment"]} />
						))}
					</ul>
				</DetailSection>
			)}
			{files.length > 0 && (
				<DetailSection
					title={
						<>
							Files <span className="tabular-nums">{detail.changedFiles}</span>
						</>
					}
				>
					<ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border font-mono text-xs">
						{files.map(file => (
							<li key={file.path} className="flex min-w-0 items-center gap-3 px-2.5 py-1">
								<span className="min-w-0 flex-1 truncate" title={`${file.path} (${file.change})`}>
									{file.path}
								</span>
								<span className="shrink-0 tabular-nums">
									<span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{" "}
									<span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
								</span>
							</li>
						))}
					</ul>
					{detail.changedFiles > files.length && (
						<p className="text-xs text-muted-foreground">
							And {detail.changedFiles - files.length} more files, which <OutLink href={`${pullRequestUrl(detail)}/files`}>GitHub</OutLink> lists.
						</p>
					)}
				</DetailSection>
			)}
		</>
	);
}
