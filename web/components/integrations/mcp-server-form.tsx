/** `McpServerForm`: adds a remote MCP server by address, with an optional header, to omp's user `mcp.json`. */
import { CircleAlert } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { REMOTE_TRANSPORTS, type McpServerRow, type RemoteTransport } from "../../../src/shared/mcp-servers";
import { Button } from "@/components/ui/button";
import { errorText, putJson } from "../../api";
import { mcpServersStore } from "../../reads";
import { describedBy, FIELD, Field } from "./client-form";
import { Callout } from "./integration-row";

const TRANSPORT_LABEL: Record<RemoteTransport, string> = { http: "Streamable HTTP", sse: "SSE" };

/** Adds a remote server by its address to omp's user `mcp.json`, with a header such as an API key when it takes one. */
export function McpServerForm({ onDone }: { onDone: () => void }) {
	const id = useId();
	const ids = { name: `${id}-name`, url: `${id}-url`, transport: `${id}-transport`, headerName: `${id}-header-name`, headerValue: `${id}-header-value` };
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [transport, setTransport] = useState<RemoteTransport>("http");
	const [headerName, setHeaderName] = useState("");
	const [headerValue, setHeaderValue] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		if (saving) return;
		const value = headerValue.trim();
		const header = headerName.trim() || value ? { name: headerName.trim(), value } : null;
		setSaving(true);
		setError(null);
		try {
			await putJson<McpServerRow>("/api/mcp-servers/add", { name: name.trim(), url: url.trim(), transport, header });
			await mcpServersStore.refresh();
			onDone();
		} catch (err) {
			const message = errorText(err);
			setError(value ? message.replaceAll(value, "the header's value") : message);
		} finally {
			setSaving(false);
		}
	};

	return (
		<form aria-label="Add an MCP server" noValidate onSubmit={event => void save(event)} className="space-y-4 rounded-lg bg-muted/60 p-4 text-[13px]">
			<p className="text-pretty text-muted-foreground">Add a remote server by its address. If it signs in with OAuth, Connect on its row once it is added.</p>
			<div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_10rem]">
				<Field id={ids.name} label="Name" hint="Prefixes its tools in a session.">
					<input
						id={ids.name}
						name="mcp-server-name"
						type="text"
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						autoFocus
						value={name}
						onChange={event => setName(event.target.value)}
						aria-describedby={describedBy(ids.name, true, false)}
						placeholder="my-server"
						className={FIELD}
					/>
				</Field>
				<Field id={ids.url} label="Address">
					<input
						id={ids.url}
						name="mcp-server-url"
						type="url"
						autoComplete="off"
						spellCheck={false}
						value={url}
						onChange={event => setUrl(event.target.value)}
						placeholder="https://mcp.example.com/mcp"
						className={FIELD}
					/>
				</Field>
				<Field id={ids.transport} label="Transport">
					<select id={ids.transport} name="mcp-server-transport" value={transport} onChange={event => setTransport(event.target.value === "sse" ? "sse" : "http")} className={FIELD}>
						{REMOTE_TRANSPORTS.map(option => (
							<option key={option} value={option}>
								{TRANSPORT_LABEL[option]}
							</option>
						))}
					</select>
				</Field>
			</div>
			<div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
				<Field id={ids.headerName} label="Header (optional)" hint="Such as Authorization, for a server that takes an API key.">
					<input
						id={ids.headerName}
						name="mcp-server-header-name"
						type="text"
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						value={headerName}
						onChange={event => setHeaderName(event.target.value)}
						aria-describedby={describedBy(ids.headerName, true, false)}
						placeholder="Authorization"
						className={FIELD}
					/>
				</Field>
				<Field id={ids.headerValue} label="Header value" hint="Saved in omp's mcp.json. Write ${VAR} to read it from your environment instead.">
					<input
						id={ids.headerValue}
						name="mcp-server-header-value"
						type="password"
						autoComplete="off"
						autoCapitalize="none"
						spellCheck={false}
						value={headerValue}
						onChange={event => setHeaderValue(event.target.value)}
						aria-describedby={describedBy(ids.headerValue, true, false)}
						placeholder="Bearer …"
						className={FIELD}
					/>
				</Field>
			</div>
			{error && (
				<Callout tone="danger" icon={CircleAlert} role="alert">
					Cannot add the server: {error}
				</Callout>
			)}
			<div className="flex items-center justify-end gap-2">
				<Button type="button" variant="ghost" size="compact" disabled={saving} onClick={onDone}>
					Cancel
				</Button>
				<Button type="submit" size="compact" loading={saving}>
					Add server
				</Button>
			</div>
		</form>
	);
}
