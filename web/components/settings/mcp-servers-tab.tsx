import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { McpServerRow, McpServersAnswer } from "../../../src/shared/mcp-servers";
import { Button } from "@/components/ui/button";
import { readTime } from "../../labels";
import { integrationsStore, mcpServersStore } from "../../reads";
import { IntegrationList } from "../integrations/integration-row";
import { McpCatalog } from "../integrations/mcp-catalog";
import { McpServerForm } from "../integrations/mcp-server-form";
import { McpServerItem } from "../integrations/mcp-server-row";
import { LoadNote } from "../sheet-details";
import { Section } from "./editor";

/** Servers you can change first, then the integrations, then the rest, each by name. */
const RANK: Record<McpServerRow["status"]["kind"], number> = { ready: 0, refused: 0, failing: 0, "signed-out": 0, local: 1, integration: 2, disabled: 3 };

function Servers({ answer: { servers, configPath } }: { answer: McpServersAnswer }) {
	const sorted = servers.toSorted((a, b) => RANK[a.status.kind] - RANK[b.status.kind] || a.name.localeCompare(b.name));
	return (
		<div className="space-y-8">
			<section className="space-y-2.5">
				<h4 className="flex items-baseline gap-2 px-1 text-[13px] font-medium">
					Installed
					<span className="text-muted-foreground tabular-nums">{servers.length}</span>
				</h4>
				{sorted.length > 0 ? (
					<IntegrationList label="Installed">
						{sorted.map(server => (
							<McpServerItem key={server.name} server={server} />
						))}
					</IntegrationList>
				) : (
					<p className="px-1 text-xs text-muted-foreground">omp loads no MCP server yet. Add one below.</p>
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
	useEffect(() => {
		if (active) integrationsStore.ensure();
	}, [active]);
	return (
		<Section
			title="MCP servers"
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
