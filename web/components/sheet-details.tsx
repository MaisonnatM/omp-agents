/** The parts shared by the inbox's pull request sheet and the tickets page's issue details. */
import { ExternalLink } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { PullRequestComment } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { age } from "../labels";
import { MessageMarkdown } from "./message-markdown";

/** What a sheet shows before its details arrive: the loading line, or the error once the read failed. */
export function LoadNote({ loading, error }: { loading: string; error: string | null }) {
	if (error) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>;
	return <p className="text-sm text-muted-foreground">{loading}</p>;
}

interface SheetFrameProps {
	title: ReactNode;
	icon?: ReactNode;
	meta: ReactNode;
	/** Fields, labels, and buttons under the meta line. */
	actions?: ReactNode;
	/** The loading line, until `children` is ready. */
	loading: string;
	error: string | null;
	children: ReactNode | null;
}

/** A sheet's header and its scrolling body: `children` once the read arrived, otherwise {@link LoadNote}. */
export function SheetFrame({ title, icon, meta, actions, loading, error, children }: SheetFrameProps) {
	return (
		<>
			<header className="space-y-1.5 border-b border-border py-3 pr-12 pl-5">
				<SheetTitle className="flex items-start gap-2.5 text-base leading-snug font-semibold">
					{icon}
					<span className="min-w-0">{title}</span>
				</SheetTitle>
				<p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{meta}</p>
				{actions}
			</header>
			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">{children ?? <LoadNote loading={loading} error={error} />}</div>
		</>
	);
}

/** A titled part of a pull request's or issue's details. */
export function DetailSection({ title, children }: { title: ReactNode; children: ReactNode }) {
	return (
		<section className="space-y-2">
			<h5 className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">{title}</h5>
			{children}
		</section>
	);
}

/** An external link that says where it goes. */
export function OutLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline">
			{children}
			<ExternalLink aria-hidden className="size-3" />
		</a>
	);
}

/**
 * Markdown from GitHub or Linear. Linear's can hold raw HTML too, which GitHub's sanitizing renders safely and whose
 * unknown tags it unwraps.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
	return (
		<div className={cn("text-sm [&_img]:max-w-full", className)}>
			<MessageMarkdown text={text} github />
		</div>
	);
}

/** How tall `Clamped` shows its content before it folds, in px, as `max-h-64`. Content only a little taller shows in full. */
const CLAMP_PX = 256;
const CLAMP_SLACK_PX = 48;

/** `children` cut at {@link CLAMP_PX} with a Show more button, when they are taller. */
export function Clamped({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const [tall, setTall] = useState(false);
	const [open, setOpen] = useState(false);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const measure = (): void => setTall(element.scrollHeight > CLAMP_PX + CLAMP_SLACK_PX);
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, []);
	const clamped = tall && !open;
	return (
		<div className="space-y-1">
			<div ref={ref} className={cn(clamped && "max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]")}>
				{children}
			</div>
			{tall && (
				<Button variant="ghost" size="compact" className="-ml-2 text-muted-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
					{open ? "Show less" : "Show more"}
				</Button>
			)}
		</div>
	);
}

interface CommentProps {
	/** What the comment says, when it was posted, and where it reads in full, which its time links to. */
	comment: Pick<PullRequestComment, "body" | "at" | "url">;
	/** The author's picture, before the name. */
	avatar?: ReactNode;
	author: string;
	/** What the comment did, after the author's name: "commented", "replied", "approved". */
	action: string;
}

/** A comment in a sheet's details: its author and what they did, when, then its markdown, indented by the avatar's width when there is one. */
export function Comment({ comment: { body, at, url }, avatar, author, action }: CommentProps) {
	const when = `${age(at)} ago`;
	return (
		<li className="space-y-1.5">
			<p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
				{avatar}
				<span className="font-medium text-foreground">{author}</span>
				{action}
				<Tooltip content={new Date(at).toLocaleString()}>
					<span>{url ? <OutLink href={url}>{when}</OutLink> : when}</span>
				</Tooltip>
			</p>
			{body.trim() && <Markdown text={body} className={avatar ? "pl-7" : undefined} />}
		</li>
	);
}
