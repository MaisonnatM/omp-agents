import { MCP_SERVICES, type McpIntegration } from "../../../src/shared/accounts";
import { PageFrame } from "../list-page";
import { IntegrationList } from "./integration-row";
import { McpIntegrationRow } from "./mcp-integration";

/** A page while omp cannot read its service: the service's integration row, to connect from here as from Settings › Integrations. */
export function DisconnectedPage({ title, meta, integration }: { title: string; meta: string; integration: McpIntegration }) {
	return (
		<PageFrame title={title} meta={meta}>
			<div className="mx-auto w-full max-w-3xl px-6 py-6">
				<IntegrationList label={`${MCP_SERVICES[integration.id].label} connection`}>
					<McpIntegrationRow integration={integration} workspaces={null} />
				</IntegrationList>
			</div>
		</PageFrame>
	);
}
