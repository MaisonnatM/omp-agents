/**
 * RPC entrypoint for restricted sessions. CLI `--tools` gets reset by late MCP discovery;
 * the SDK's `restrictToolNames` excludes MCP, extensions, and tools outside the allowlist.
 */
import { config, rpcMode, sessionSdk, settingsRegistry } from "./modules";
import { TOOL_POLICY_ENTRY } from "./tool-policy";

const tools: string[] = JSON.parse(process.argv[2]!);
Bun.env.PI_NO_PTY = "1";
Bun.env.PI_NO_TITLE = "1";
const settings = await config.Settings.loadIsolated({ cwd: process.cwd() });
for (const setting of settingsRegistry.all()) {
	if (setting.definition.protocolDefault?.includes("rpc")) setting.pinDefault(settings);
}
const { session, setToolUIContext, subagentEventBus } = await sessionSdk.createAgentSession({
	cwd: process.cwd(),
	toolNames: tools,
	enableLsp: tools.includes("lsp"),
	restrictToolNames: true,
	hasUI: true,
	interactivePrompts: true,
	allowSessionModelFallback: false,
	settingsApproval: false,
	tuiTranscript: false,
	autoTitle: false,
	settings,
});
session.sessionManager.appendCustomEntry(TOOL_POLICY_ENTRY, { tools });
await rpcMode.runRpcMode(session, { setToolUIContext, subagentEventBus });
