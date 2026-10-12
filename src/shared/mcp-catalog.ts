/**
 * The remote MCP servers Settings › MCP servers offers to add: each its vendor's own, reachable without a local
 * command, and either open or signed in to with OAuth and dynamic client registration, which omp's sign-in needs.
 * Settings › Integrations' services are left out.
 */
import type { RemoteTransport } from "./mcp-servers";

export const MCP_CATEGORIES = ["Developer tools", "Data", "Observability", "Productivity", "Design", "Payments", "Docs & search"] as const;
export type McpCategory = (typeof MCP_CATEGORIES)[number];

export interface McpCatalogEntry {
	/** The name a server added from the entry takes in omp's config, unless one by that name is there. */
	id: string;
	label: string;
	description: string;
	url: string;
	transport: RemoteTransport;
	/** `oauth`: adding it opens the vendor's sign-in; `none`: it answers without one. */
	auth: "oauth" | "none";
	category: McpCategory;
	/** The hosts a configured server counts as this entry on, when more than the URL's own, such as a vendor's other regions. */
	hosts?: readonly string[];
}

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
	{ id: "gitlab", label: "GitLab", description: "Issues, merge requests, and pipelines on GitLab.com.", url: "https://gitlab.com/api/v4/mcp", transport: "http", auth: "oauth", category: "Developer tools" },
	{ id: "vercel", label: "Vercel", description: "Projects, deployments, and their build logs.", url: "https://mcp.vercel.com", transport: "http", auth: "oauth", category: "Developer tools" },
	{ id: "netlify", label: "Netlify", description: "Create, deploy, and manage Netlify sites.", url: "https://netlify-mcp.netlify.app/mcp", transport: "http", auth: "oauth", category: "Developer tools" },
	{ id: "cloudflare", label: "Cloudflare Workers", description: "Workers, KV, R2, and D1 in your Cloudflare account.", url: "https://bindings.mcp.cloudflare.com/mcp", transport: "http", auth: "oauth", category: "Developer tools" },
	{ id: "railway", label: "Railway", description: "Projects, services, deployments, and logs.", url: "https://mcp.railway.com/mcp", transport: "http", auth: "oauth", category: "Developer tools" },
	{ id: "buildkite", label: "Buildkite", description: "Pipelines, builds, and job logs.", url: "https://mcp.buildkite.com/mcp", transport: "http", auth: "oauth", category: "Developer tools" },
	{ id: "semgrep", label: "Semgrep", description: "Scan code for security issues.", url: "https://mcp.semgrep.ai/mcp", transport: "http", auth: "oauth", category: "Developer tools" },
	{ id: "jam", label: "Jam", description: "Bug reports with their console logs, network requests, and repro steps.", url: "https://mcp.jam.dev/mcp", transport: "http", auth: "oauth", category: "Developer tools" },
	{ id: "supabase", label: "Supabase", description: "Projects, tables, SQL, and edge functions.", url: "https://mcp.supabase.com/mcp", transport: "http", auth: "oauth", category: "Data" },
	{ id: "neon", label: "Neon", description: "Serverless Postgres projects, branches, and queries.", url: "https://mcp.neon.tech/mcp", transport: "http", auth: "oauth", category: "Data" },
	{ id: "prisma", label: "Prisma", description: "Prisma Postgres databases and their migrations.", url: "https://mcp.prisma.io/mcp", transport: "http", auth: "oauth", category: "Data" },
	{ id: "airtable", label: "Airtable", description: "Bases, tables, and records.", url: "https://mcp.airtable.com/mcp", transport: "http", auth: "oauth", category: "Data" },
	{ id: "sentry", label: "Sentry", description: "Issues, errors, traces, and Seer's root-cause analysis.", url: "https://mcp.sentry.dev/mcp", transport: "http", auth: "oauth", category: "Observability" },
	{
		id: "datadog",
		label: "Datadog",
		description: "Logs, metrics, traces, monitors, and incidents. On another Datadog site, add your site's address.",
		url: "https://mcp.datadoghq.com/v1/mcp",
		transport: "http",
		auth: "oauth",
		category: "Observability",
		hosts: ["mcp.datadoghq.com", "mcp.datadoghq.eu"],
	},
	{ id: "grafana", label: "Grafana", description: "Dashboards, queries, and alerts in Grafana Cloud.", url: "https://mcp.grafana.com/mcp", transport: "http", auth: "oauth", category: "Observability" },
	{ id: "honeycomb", label: "Honeycomb", description: "Query traces and events.", url: "https://mcp.honeycomb.io/mcp", transport: "http", auth: "oauth", category: "Observability" },
	{ id: "posthog", label: "PostHog", description: "Product analytics, feature flags, and experiments.", url: "https://mcp.posthog.com/mcp", transport: "http", auth: "oauth", category: "Observability" },
	{ id: "amplitude", label: "Amplitude", description: "Charts, events, and user analytics.", url: "https://mcp.amplitude.com/mcp", transport: "http", auth: "oauth", category: "Observability" },
	{ id: "notion", label: "Notion", description: "Search, read, and edit pages and databases.", url: "https://mcp.notion.com/mcp", transport: "http", auth: "oauth", category: "Productivity" },
	{ id: "atlassian", label: "Atlassian", description: "Jira issues and Confluence pages.", url: "https://mcp.atlassian.com/v1/mcp", transport: "http", auth: "oauth", category: "Productivity" },
	{ id: "monday", label: "monday.com", description: "Boards, items, and updates.", url: "https://mcp.monday.com/mcp", transport: "http", auth: "oauth", category: "Productivity" },
	{ id: "clickup", label: "ClickUp", description: "Tasks, lists, and docs.", url: "https://mcp.clickup.com/mcp", transport: "http", auth: "oauth", category: "Productivity" },
	{ id: "granola", label: "Granola", description: "Your meeting notes and transcripts.", url: "https://mcp.granola.ai/mcp", transport: "http", auth: "oauth", category: "Productivity" },
	{ id: "intercom", label: "Intercom", description: "Conversations, contacts, and help articles.", url: "https://mcp.intercom.com/mcp", transport: "http", auth: "oauth", category: "Productivity" },
	{ id: "zapier", label: "Zapier", description: "The actions you enable for the apps connected to Zapier.", url: "https://mcp.zapier.com/api/mcp/mcp", transport: "http", auth: "oauth", category: "Productivity" },
	{ id: "canva", label: "Canva", description: "Designs, templates, and exports.", url: "https://mcp.canva.com/mcp", transport: "http", auth: "oauth", category: "Design" },
	{ id: "webflow", label: "Webflow", description: "Sites, pages, and CMS collections.", url: "https://mcp.webflow.com/sse", transport: "sse", auth: "oauth", category: "Design" },
	{ id: "wix", label: "Wix", description: "Wix sites and their business apps.", url: "https://mcp.wix.com/mcp", transport: "http", auth: "oauth", category: "Design" },
	{ id: "mobbin", label: "Mobbin", description: "Real app screens and flows to reference while designing.", url: "https://api.mobbin.com/mcp", transport: "http", auth: "oauth", category: "Design" },
	{ id: "stripe", label: "Stripe", description: "Customers, payments, subscriptions, and Stripe's docs.", url: "https://mcp.stripe.com", transport: "http", auth: "oauth", category: "Payments" },
	{ id: "paypal", label: "PayPal", description: "Invoices, orders, and transactions.", url: "https://mcp.paypal.com/mcp", transport: "http", auth: "oauth", category: "Payments" },
	{ id: "square", label: "Square", description: "Payments, catalog, and orders.", url: "https://mcp.squareup.com/sse", transport: "sse", auth: "oauth", category: "Payments" },
	{ id: "context7", label: "Context7", description: "Current docs and examples for libraries and frameworks.", url: "https://mcp.context7.com/mcp", transport: "http", auth: "none", category: "Docs & search" },
	{ id: "deepwiki", label: "DeepWiki", description: "Ask about any public GitHub repository.", url: "https://mcp.deepwiki.com/mcp", transport: "http", auth: "none", category: "Docs & search" },
	{ id: "microsoft-learn", label: "Microsoft Learn", description: "Microsoft and Azure documentation.", url: "https://learn.microsoft.com/api/mcp", transport: "http", auth: "none", category: "Docs & search" },
	{ id: "cloudflare-docs", label: "Cloudflare Docs", description: "Cloudflare's documentation.", url: "https://docs.mcp.cloudflare.com/mcp", transport: "http", auth: "none", category: "Docs & search" },
	{ id: "huggingface", label: "Hugging Face", description: "Models, datasets, Spaces, and papers on the Hub.", url: "https://huggingface.co/mcp", transport: "http", auth: "none", category: "Docs & search" },
];

const hostsOf = (entry: McpCatalogEntry): readonly string[] => entry.hosts ?? [new URL(entry.url).host];

/** The catalog entry `host` belongs to, or `null`. */
export const catalogEntryOn = (host: string | null): McpCatalogEntry | null => (host === null ? null : (MCP_CATALOG.find(entry => hostsOf(entry).includes(host)) ?? null));

export const catalogEntry = (id: string): McpCatalogEntry | null => MCP_CATALOG.find(entry => entry.id === id) ?? null;
