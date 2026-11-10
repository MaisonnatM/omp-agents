/**
 * Get started's Tools and workflows step: GitHub, every Settings › Integrations service, and pstack, what still needs
 * you above what is ready, each folded to its name, status, and summary, and opening in place on its full row.
 */
import { Check, ChevronDown, ChevronUp, GitPullRequest, type LucideIcon, Workflow } from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { connectionsOf, type IntegrationsAnswer, MCP_INTEGRATIONS, MCP_SERVICES, type McpIntegrationId, signedIn } from "../../src/shared/accounts";
import type { StarterKitStatus } from "../../src/shared/readiness";
import type { GithubStatus } from "../../src/shared/source-control";
import type { Observation } from "../get-started-model";
import type { PolledEntry } from "../polled-store";
import { CheckAgain, GITHUB_SUMMARY, GithubRow, githubSignedIn, githubStatus, PSTACK_SUMMARY, PstackRow, pstackLoaded, pstackStatus } from "./get-started-steps";
import type { BrandLogo } from "./integrations/brand-logos";
import { Callout, LIST_SURFACE, MarkTile } from "./integrations/integration-row";
import { StatusBadge, type StatusLabel } from "./integrations/mcp-connection-controls";
import { McpIntegrationRow } from "./integrations/mcp-integration";
import { integrationStatus, SERVICES } from "./integrations/services";
import { LoadNote } from "./sheet-details";

type ItemId = "github" | McpIntegrationId | "pstack";

/** One thing the step sets up, folded or open. */
interface Item {
	id: ItemId;
	name: string;
	logo: BrandLogo | null;
	icon: LucideIcon | undefined;
	/** Its fact is still being read. */
	checking: boolean;
	/** Connected, signed in, or loaded. */
	ready: boolean;
	/** The badge its full row shows. */
	status: StatusLabel;
	/** The summary its full row shows. */
	summary: string;
	/** Its full row, an `<li>` with its own sign-in, or the way to install it. */
	row: ReactNode;
}

function McpRow({ id, integrations: { read, error } }: { id: McpIntegrationId; integrations: PolledEntry<IntegrationsAnswer> }) {
	if (!read) {
		return (
			<li className="p-4">
				<LoadNote loading="Checking omp's MCP servers…" error={error && `Cannot load the integrations: ${error}`} />
			</li>
		);
	}
	return <McpIntegrationRow integration={read.data.integrations[id]} placeable={false} />;
}

export interface ToolsFacts {
	github: Observation<GithubStatus>;
	integrations: PolledEntry<IntegrationsAnswer>;
	kit: Observation<StarterKitStatus>;
}

/** GitHub, each MCP service in Settings › Integrations' order, then pstack. */
function itemsOf({ github, integrations, kit }: ToolsFacts, onKitStep: () => void): Item[] {
	return [
		{
			id: "github",
			name: "GitHub",
			logo: null,
			icon: GitPullRequest,
			checking: github.kind === "checking",
			ready: githubSignedIn(github),
			status: githubStatus(github),
			summary: GITHUB_SUMMARY,
			row: <GithubRow github={github} />,
		},
		...MCP_INTEGRATIONS.map((id): Item => {
			const integration = integrations.read?.data.integrations[id];
			return {
				id,
				name: MCP_SERVICES[id].label,
				logo: SERVICES[id].logo,
				icon: undefined,
				checking: !integration && !integrations.error,
				ready: integration !== undefined && connectionsOf(integration).some(signedIn),
				status: integration ? integrationStatus(integration) : { label: "Unknown", color: "gray" },
				summary: SERVICES[id].gives,
				row: <McpRow id={id} integrations={integrations} />,
			};
		}),
		{
			id: "pstack",
			name: "pstack",
			logo: null,
			icon: Workflow,
			checking: kit.kind === "checking",
			ready: pstackLoaded(kit),
			status: pstackStatus(kit),
			summary: PSTACK_SUMMARY,
			row: <PstackRow kit={kit} onKitStep={onKitStep} />,
		},
	];
}

/** A click on the open row's header, outside its controls and not ending a text selection. */
function headerClicked(event: MouseEvent<HTMLLIElement>): boolean {
	const target = event.target as Element;
	const header = event.currentTarget.querySelector("li")?.firstElementChild;
	return !!header?.contains(target) && !target.closest("button, a, input, select, textarea, [role=menuitem]") && !window.getSelection()?.toString();
}

/** An item folded to its name, status, and summary, or open on its full row; either header toggles it. */
function Disclosure({ item, open, onToggle }: { item: Item; open: boolean; onToggle: () => void }) {
	if (open) {
		return (
			// The fold button is the keyboard's way to fold; a click on the rest of the header is the pointer's shortcut.
			<li className="relative [&>ul>li>div:first-child]:cursor-pointer" onClick={event => headerClicked(event) && onToggle()}>
				<ul aria-label={item.name} className="pe-8.5">
					{item.row}
				</ul>
				<Button variant="ghost" size="icon-compact" aria-expanded aria-label={`Fold ${item.name}`} className="absolute end-4 top-4" onClick={onToggle}>
					<ChevronUp />
				</Button>
			</li>
		);
	}
	return (
		<li>
			<button
				type="button"
				aria-expanded={false}
				onClick={onToggle}
				className="flex w-full items-start gap-3.5 p-4 text-start transition-colors duration-150 ease-out hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
			>
				<MarkTile logo={item.logo} icon={item.icon} name={item.name} />
				<span className="min-w-0 flex-1">
					<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="text-[13px] font-medium">{item.name}</span>
						<StatusBadge {...item.status} />
					</span>
					<span className="mt-0.5 block text-[13px] text-pretty text-muted-foreground">{item.summary}</span>
				</span>
				<span aria-hidden className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
					<ChevronDown className="size-3.5" />
				</span>
			</button>
		</li>
	);
}

function Group({ title, items, open, onToggle }: { title: string; items: Item[]; open: ItemId | null; onToggle: (id: ItemId) => void }) {
	if (items.length === 0) return null;
	return (
		<section className="space-y-2.5">
			<h3 className="flex items-baseline gap-2 px-1 text-[13px] font-medium">
				{title}
				<span className="text-muted-foreground tabular-nums">{items.length}</span>
			</h3>
			<ul aria-label={title} className={LIST_SURFACE}>
				{items.map(item => (
					<Disclosure key={item.id} item={item} open={open === item.id} onToggle={() => onToggle(item.id)} />
				))}
			</ul>
		</section>
	);
}

/** What still needs you, the first of it open, above what is ready; once every status is read, so nothing moves. */
function Groups({ items }: { items: Item[] }) {
	const needs = items.filter(item => !item.ready);
	const [open, setOpen] = useState<ItemId | null>(() => needs[0]?.id ?? null);
	const toggle = (id: ItemId): void => setOpen(open === id ? null : id);
	return (
		<div className="space-y-5">
			{needs.length === 0 && (
				<Callout tone="info" icon={Check}>
					Everything is set up. New sessions get these tools and pstack's skills.
				</Callout>
			)}
			<Group title="Action needed" items={needs} open={open} onToggle={toggle} />
			<Group title="Ready" items={items.filter(item => item.ready)} open={open} onToggle={toggle} />
		</div>
	);
}

/** The step's body, checked again when the window regains focus; pstack's row sends you to the Starter kit step. */
export function ToolsStep({ facts, onKitStep, onRefresh, refreshing }: { facts: ToolsFacts; onKitStep: () => void; onRefresh: () => void; refreshing: boolean }) {
	const items = itemsOf(facts, onKitStep);
	return (
		<div className="space-y-5">
			{items.some(item => item.checking) ? <LoadNote loading="Checking what is connected…" error={null} /> : <Groups items={items} />}
			<CheckAgain onRefresh={onRefresh} refreshing={refreshing} />
		</div>
	);
}
