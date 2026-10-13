/**
 * `DiffStack`: every changed file's diff in one scroll, as GitHub lists a pull request's files. A file reads and
 * highlights only once it nears the view, and the browser skips laying out the ones far from it, so a list of thousands
 * of files costs one placeholder each until you reach it.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { ChangedEntry } from "../../../src/shared/changes";
import { CLICK_TO_LOAD_LINES, changedLines, estimatedRows, lastAtOrAbove } from "../../changes-model";
import { cn } from "@/lib/utils";
import { LineCounts } from "../line-counts";
import { DiffView, ROW_HEIGHT } from "./code-view";
import { StatusLetter, statusLabel } from "./file-tree";

/** How far beyond the view a file starts to read, so it is drawn by the time it scrolls in. */
const READ_AHEAD = "1200px 0px";
/** How long a file must stay near the view before it reads, so a fast scroll past hundreds of files reads none of them. */
const SETTLE_MS = 120;

type WatchNear = (element: Element, onNear: () => void) => () => void;

/** One `IntersectionObserver` for every file, calling each file's `onNear` as it comes within {@link READ_AHEAD}. */
function useNearObserver(root: HTMLElement | null): WatchNear | null {
	const [watch, setWatch] = useState<WatchNear | null>(null);
	useLayoutEffect(() => {
		if (!root) return;
		const timers = new Map<Element, { onNear: () => void; timer?: number }>();
		const observer = new IntersectionObserver(
			entries => {
				for (const { target, isIntersecting } of entries) {
					const watched = timers.get(target);
					if (!watched) continue;
					window.clearTimeout(watched.timer);
					if (isIntersecting) watched.timer = window.setTimeout(watched.onNear, SETTLE_MS);
				}
			},
			{ root, rootMargin: READ_AHEAD },
		);
		setWatch(() => (element: Element, onNear: () => void) => {
			timers.set(element, { onNear });
			observer.observe(element);
			return () => {
				window.clearTimeout(timers.get(element)?.timer);
				timers.delete(element);
				observer.unobserve(element);
			};
		});
		return () => {
			for (const { timer } of timers.values()) window.clearTimeout(timer);
			observer.disconnect();
		};
	}, [root]);
	return watch;
}

export interface DiffStackHandle {
	scrollTo: (path: string) => void;
}

interface DiffStackProps {
	ref: Ref<DiffStackHandle>;
	/** The files in the explorer's order. */
	files: readonly ChangedEntry[];
	fileUrl: (path: string) => string;
	/** A new version reads the files read so far again. */
	version: string | number;
	/** The file the stack opens at. */
	initial: string | null;
	/** The file at the top of the view, as you scroll. */
	onCurrent: (path: string) => void;
}

export function DiffStack({ ref, files, fileUrl, version, initial, onCurrent }: DiffStackProps) {
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const near = useNearObserver(root);
	const latest = useRef({ files, onCurrent });
	latest.current = { files, onCurrent };
	// The sections are the root's children in `files` order, so a file's index finds its section.
	const scrollTo = (path: string): void => {
		const section = root?.children[latest.current.files.findIndex(file => file.path === path)];
		if (root && section instanceof HTMLElement) root.scrollTop = section.offsetTop;
	};
	useImperativeHandle(ref, () => ({ scrollTo }), [root]);
	useEffect(() => {
		if (near && initial !== null) scrollTo(initial);
	}, [near]);
	useEffect(() => {
		if (!root) return;
		let frame = 0;
		const update = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const { files, onCurrent } = latest.current;
				const sections = root.children as HTMLCollectionOf<HTMLElement>;
				const at = lastAtOrAbove(sections.length, index => sections[index]!.offsetTop, root.scrollTop);
				if (files[at]) onCurrent(files[at].path);
			});
		};
		root.addEventListener("scroll", update, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			root.removeEventListener("scroll", update);
		};
	}, [root]);
	return (
		<div ref={setRoot} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
			{near && files.map(file => <FileSection key={file.path} file={file} url={fileUrl(file.path)} version={version} watchNear={near} />)}
		</div>
	);
}

interface FileSectionProps {
	file: ChangedEntry;
	url: string;
	version: string | number;
	watchNear: WatchNear;
}

/** One file: its header, sticky while its diff scrolls under it, and the diff once it neared the view. */
const FileSection = memo(function FileSection({ file, url, version, watchNear }: FileSectionProps) {
	const ref = useRef<HTMLElement>(null);
	const [reached, setReached] = useState(false);
	const [folded, setFolded] = useState(false);
	const lines = changedLines(file);
	const [asked, setAsked] = useState(lines <= CLICK_TO_LOAD_LINES);
	useEffect(() => {
		if (reached || !ref.current) return;
		return watchNear(ref.current, () => setReached(true));
	}, [reached, watchNear]);
	const Chevron = folded ? ChevronRight : ChevronDown;
	const height = estimatedRows(file) * ROW_HEIGHT;
	return (
		<section ref={ref} aria-label={file.path} className="border-b border-border">
			<div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-1.5">
				<button
					type="button"
					aria-expanded={!folded}
					aria-label={folded ? `Show ${file.path}` : `Hide ${file.path}`}
					onClick={() => setFolded(value => !value)}
					className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<Chevron aria-hidden className="size-3.5" />
				</button>
				<StatusLetter file={file} />
				<p className={cn("min-w-0 flex-1 truncate font-mono text-xs", file.status === "deleted" && "line-through opacity-70")} title={`${file.path}: ${statusLabel(file)}`}>
					{file.path}
				</p>
				<LineCounts added={file.added} removed={file.removed} />
			</div>
			{folded ? null : !asked ? (
				<p className="px-4 py-6 text-center text-sm text-muted-foreground">
					{`A large diff of ${lines} lines. `}
					<button type="button" className="text-foreground underline underline-offset-4" onClick={() => setAsked(true)}>
						Load diff
					</button>
				</p>
			) : reached ? (
				<div className="[content-visibility:auto]" style={{ containIntrinsicSize: `auto ${height}px` }}>
					<DiffView url={url} version={version} />
				</div>
			) : (
				<div aria-hidden style={{ height }} />
			)}
		</section>
	);
});
