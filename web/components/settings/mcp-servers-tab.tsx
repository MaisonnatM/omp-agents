import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { MCP_SERVICES } from "../../../src/shared/accounts";
import { type McpServersAnswer, type OwnServer, ownServers } from "../../../src/shared/mcp-servers";
import { Button } from "@/components/ui/button";
import { readTime } from "../../labels";
import { mcpServersStore } from "../../reads";
import { hashForSettings } from "../../routing";
import { IntegrationList } from "../integrations/integration-row";
import { McpCatalog } from "../integrations/mcp-catalog";
import { McpServerForm } from "../integrations/mcp-server-form";
import { McpServerItem } from "../integrations/mcp-server-row";
import { LoadNote } from "../sheet-details";
import { Section } from "./editor";

/** Servers you can change first, then the rest, each by name. */
const RANK: Record<OwnServer["status"]["kind"], number> = { ready: 0, refused: 0, failing: 0, "signed-out": 0, local: 1, disabled: 2 };

const AND = new Intl.ListFormat("en", { type: "conjunction" });

function Servers({ answer: { servers, configPath } }: { answer: McpServersAnswer }) {
	const { own, integrations } = ownServers(servers);
	const sorted = own.toSorted((a, b) => RANK[a.status.kind] - RANK[b.status.kind] || a.name.localeCompare(b.name));
	return (
		<div className="space-y-8">
			<section className="space-y-2.5">
				<h4 className="flex items-baseline gap-2 px-1 text-[13px] font-medium">
					Installed
					<span className="text-muted-foreground tabular-nums">{sorted.length}</span>
				</h4>
				{sorted.length > 0 ? (
					<IntegrationList label="Installed">
						{sorted.map(server => (
							<McpServerItem key={server.name} server={server} />
						))}
					</IntegrationList>
				) : (
					<p className="px-1 text-xs text-muted-foreground">{integrations.length > 0 ? "omp loads no other MCP server yet. Add one below." : "omp loads no MCP server yet. Add one below."}</p>
				)}
				{integrations.length > 0 && (
					<p className="px-1 text-xs text-muted-foreground">
						{AND.format(integrations.map(id => MCP_SERVICES[id].label))} {integrations.length === 1 ? "comes" : "come"} from Integrations.{" "}
						<a href={hashForSettings("integrations")} className="text-foreground underline-offset-2 hover:underline">
							Open Integrations
						</a>
					</p>
				)}
			</section>
			<McpCatalog servers={servers} />
			<p className="px-1 text-xs text-pretty text-muted-foreground">
				This page adds servers to <code className="font-mono">{configPath}</code>, as <code className="font-mono">/mcp add</code> does, and omp keeps their sign-ins in its own credential store. New omp sessions load them; a running session loads them after{" "}
				<code className="font-mono">/mcp reload</code>.
			</p>
		</div>
	);
}

/** Every MCP server omp loads for you, where omp stands with each, and the catalog and form that add more. */
export function McpServersTab({ active }: { active: boolean }) {
	const { read, error, refreshing } = mcpServersStore.usePolling(null, active);
	const [adding, setAdding] = useState(false);
	const meta = "The MCP servers omp loads in every session";
	return (
		<Section
			meta={read ? `${meta} · updated ${readTime(read.at)}` : meta}
			actions={
				<>
					<Button variant="ghost" size="compact" leadingIcon={RefreshCw} disabled={refreshing} onClick={() => void mcpServersStore.refresh(null, { fresh: true })}>
						{refreshing ? "Refreshing…" : "Refresh"}
					</Button>
					<Button variant="secondary" size="compact" leadingIcon={Plus} disabled={adding} onClick={() => setAdding(true)}>
						Add server
					</Button>
				</>
			}
		>
			{adding && <McpServerForm onDone={() => setAdding(false)} />}
			{read ? (
				<>
					{error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Cannot refresh the MCP servers: {error}</p>}
					<Servers answer={read.data} />
				</>
			) : (
				<LoadNote loading="Checking omp's MCP servers…" error={error && `Cannot load the MCP servers: ${error}`} />
			)}
		</Section>
	);
}
