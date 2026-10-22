/** A pull request's Markdown as GitHub shows it: GitHub's preset with the repository's autolinks and alerts, and uploads drawn as images, videos, or attachments. */
import { ExternalLinkIcon, InfoIcon, LightbulbIcon, MessageSquareWarningIcon, OctagonAlertIcon, PaperclipIcon, TriangleAlertIcon } from "lucide-react";
import { memo, useMemo } from "react";
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";
import { GITHUB_PRESET, type MarkdownPreset, MessageMarkdown } from "../message-markdown";
import { rehypePullRequestMarkdown, type GitHubAlert } from "./pr-markdown.logic";

const ALERTS = {
	note: { label: "Note", Icon: InfoIcon, border: "border-blue-500/70", title: "text-blue-600 dark:text-blue-400" },
	tip: { label: "Tip", Icon: LightbulbIcon, border: "border-emerald-500/70", title: "text-emerald-600 dark:text-emerald-400" },
	important: { label: "Important", Icon: MessageSquareWarningIcon, border: "border-purple-500/70", title: "text-purple-600 dark:text-purple-400" },
	warning: { label: "Warning", Icon: TriangleAlertIcon, border: "border-amber-500/70", title: "text-amber-600 dark:text-amber-500" },
	caution: { label: "Caution", Icon: OctagonAlertIcon, border: "border-red-500/70", title: "text-red-600 dark:text-red-400" },
} satisfies Record<GitHubAlert, { label: string; Icon: typeof InfoIcon; border: string; title: string }>;

function Attachment({ url }: { url: string }) {
	return (
		<a href={url} rel="noreferrer noopener" target="_blank" className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm hover:bg-muted/60">
			<PaperclipIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate">Open attachment on GitHub</span>
			<ExternalLinkIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
		</a>
	);
}

const COMPONENTS: Components = {
	blockquote: ({ node, children, ...props }) => {
		const type = node?.properties.dataAlert;
		const alert = typeof type === "string" ? ALERTS[type as GitHubAlert] : undefined;
		return alert ? (
			<div role="note" className={cn("my-1 border-l-2 pl-3", alert.border)}>
				<p className={cn("flex items-center gap-1.5 font-medium", alert.title)}>
					<alert.Icon aria-hidden className="size-3.5 shrink-0" />
					{alert.label}
				</p>
				{children}
			</div>
		) : <blockquote {...props}>{children}</blockquote>;
	},
	figure: ({ node, ...props }) => {
		const url = node?.properties.dataAttachment;
		return typeof url === "string" ? <Attachment url={url} /> : <figure {...props} />;
	},
	code: ({ node: _node, ...props }) => (
		<code {...props} style={{ border: "1px solid var(--contrast-border, var(--border))", borderRadius: "0.375rem", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone", background: "var(--muted)", padding: "0.1rem 0.35rem", color: "var(--contrast-foreground, var(--foreground))", fontSize: "0.75rem" }} />
	),
};

export const PullRequestMarkdown = memo(function PullRequestMarkdown({ text, repo, className }: {
	text: string;
	repo: { owner: string; repo: string };
	className?: string;
}) {
	const preset = useMemo<MarkdownPreset>(() => ({
		...GITHUB_PRESET,
		rehype: [...GITHUB_PRESET.rehype, [rehypePullRequestMarkdown, { repositoryUrl: `https://github.com/${repo.owner}/${repo.repo}` }]],
		components: { ...GITHUB_PRESET.components, ...COMPONENTS },
	}), [repo.owner, repo.repo]);
	return (
		<div className={cn("text-sm [&_details]:border-0 [&_summary]:text-foreground/80", className)}>
			<MessageMarkdown text={text} preset={preset} />
		</div>
	);
});
