/**
 * `DiffStack`: every changed file's diff in one scroll, as GitHub lists a pull request's files. A file reads and
 * highlights only once it nears the view, and the browser skips laying out the ones far from it, so a list of thousands
 * of files costs one placeholder each until you reach it.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangedEntry, ChangedFileText } from "../../../src/shared/changes";
import { useRead } from "../../reads";
import { cn } from "@/lib/utils";
import { LineCounts } from "../line-counts";
import { DiffView } from "./code-view";
import { StatusLetter, statusLabel } from "./file-tree";

/** How far beyond the view a file starts to read, so it is drawn by the time it scrolls in. */
const READ_AHEAD = "1200px 0px";
/** How long a file must stay near the view before it reads, so a fast scroll past hundreds of files reads none of them. */
const SETTLE_MS = 120;
/** A file changing more lines than this waits for a click, as GitHub's large diffs do. */
const LARGE = 2000;
/** One diff row's height, `leading-5`. */
const ROW = 20;

/** A file's height before it is read: its changed rows and a few around them, so the scrollbar is close from the start. */
const estimate = (file: ChangedEntry): number => Math.min(LARGE, (file.added ?? 0) + (file.removed ?? 0) + 6) * ROW;

type Watch = (element: Element, onChange: (near: boolean) => void) => () => void;

/** One `IntersectionObserver` that many elements share, each with its own callback. */
function useSharedObserver(root: HTMLElement | null, rootMargin: string): Watch | null {
	const [watch, setWatch] = useState<Watch | null>(null);
	useLayoutEffect(() => {
		if (!root) return;
		const callbacks = new Map<Element, (near: boolean) => void>();
		const observer = new IntersectionObserver(entries => entries.forEach(entry => callbacks.get(entry.target)?.(entry.isIntersecting)), { root, rootMargin });
		setWatch(() => (element: Element, onChange: (near: boolean) => void) => {
			callbacks.set(element, onChange);
			observer.observe(element);
			return () => {
				callbacks.delete(element);
				observer.unobserve(element);
			};
		});
		return () => observer.disconnect();
	}, [root, rootMargin]);
	return watch;
}

interface DiffStackProps {
	/** The files in the explorer's order. */
	files: readonly ChangedEntry[];
	fileUrl: (path: string) => string;
	/** A new version reads the files read so far again. */
	version: string | number;
	/** The file to scroll to; a new object scrolls again, even to the same file. */
	target: { path: string } | null;
	/** The file at the top of the view, as you scroll. */
	onCurrent: (path: string) => void;
}

export function DiffStack({ files, fileUrl, version, target, onCurrent }: DiffStackProps) {
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const near = useSharedObserver(root, READ_AHEAD);
	// A band just under the top edge: the first file crossing it is the one you are reading. It starts a pixel down,
	// since an observer counts a file that ends exactly at the edge, as one does after a jump, as crossing it.
	const top = useSharedObserver(root, "-1px 0px -95% 0px");
	const sections = useRef(new Map<string, HTMLElement>());
	const crossing = useRef(new Set<string>());
	const positions = useMemo(() => new Map(files.map((file, at) => [file.path, at])), [files]);
	const index = useRef(positions);
	index.current = positions;
	const latest = useRef(onCurrent);
	latest.current = onCurrent;
	const cross = useCallback((path: string, inBand: boolean) => {
		if (inBand) crossing.current.add(path);
		else crossing.current.delete(path);
		let first: string | null = null;
		for (const each of crossing.current) if (first === null || (index.current.get(each) ?? 0) < (index.current.get(first) ?? 0)) first = each;
		if (first !== null) latest.current(first);
	}, []);
	const register = useCallback((path: string, element: HTMLElement | null) => {
		if (element) sections.current.set(path, element);
		else sections.current.delete(path);
	}, []);
	const ready = near !== null && top !== null;
	useEffect(() => {
		if (!target || !root || !ready) return;
		const section = sections.current.get(target.path);
		if (section) root.scrollTop = section.offsetTop;
	}, [target, root, ready]);
	return (
		<div ref={setRoot} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
			{near &&
				top &&
				files.map(file => <FileSection key={file.path} file={file} url={fileUrl(file.path)} version={version} near={near} top={top} register={register} cross={cross} />)}
		</div>
	);
}

interface FileSectionProps {
	file: ChangedEntry;
	url: string;
	version: string | number;
	near: Watch;
	top: Watch;
	register: (path: string, element: HTMLElement | null) => void;
	cross: (path: string, inBand: boolean) => void;
}

/** One file: its header, sticky while its diff scrolls under it, and the diff once it neared the view. */
const FileSection = memo(function FileSection({ file, url, version, near, top, register, cross }: FileSectionProps) {
	const ref = useRef<HTMLElement>(null);
	const [reached, setReached] = useState(false);
	const [folded, setFolded] = useState(false);
	const large = (file.added ?? 0) + (file.removed ?? 0) > LARGE;
	const [asked, setAsked] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		register(file.path, element);
		const stopTop = top(element, inBand => cross(file.path, inBand));
		let timer: number | undefined;
		const stopNear = reached
			? () => {}
			: near(element, isNear => {
					window.clearTimeout(timer);
					if (isNear) timer = window.setTimeout(() => setReached(true), SETTLE_MS);
				});
		return () => {
			window.clearTimeout(timer);
			stopNear();
			stopTop();
			cross(file.path, false);
			register(file.path, null);
		};
	}, [file.path, reached, near, top, register, cross]);
	const Chevron = folded ? ChevronRight : ChevronDown;
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
			{!folded &&
				(large && !asked ? (
					<p className="px-4 py-6 text-center text-sm text-muted-foreground">
						{`A large diff of ${(file.added ?? 0) + (file.removed ?? 0)} lines. `}
						<button type="button" className="text-foreground underline underline-offset-4" onClick={() => setAsked(true)}>
							Load diff
						</button>
					</p>
				) : reached ? (
					<div className="[content-visibility:auto]" style={{ containIntrinsicSize: `auto ${estimate(file)}px` }}>
						<FileBody url={url} version={version} />
					</div>
				) : (
					<div aria-hidden style={{ height: estimate(file) }} />
				))}
		</section>
	);
});

function FileBody({ url, version }: { url: string; version: string | number }) {
	const read = useRead<ChangedFileText>(url, version);
	return <DiffView file={read.data} error={read.error} />;
}
