import type { ClientMsg, GuestPhase, Item, RosterHost, ServerMsg } from "../src/shared";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
	version: $("omp-version"),
	connection: $("connection"),
	hosts: $<HTMLUListElement>("hosts"),
	empty: $("empty"),
	rosterError: $("roster-error"),
	placeholder: $("placeholder"),
	session: $("session"),
	name: $("session-name"),
	meta: $("session-meta"),
	phase: $("session-phase"),
	transcript: $<HTMLOListElement>("transcript"),
	composer: $<HTMLFormElement>("composer"),
	prompt: $<HTMLTextAreaElement>("prompt"),
	send: $<HTMLButtonElement>("send"),
	abort: $<HTMLButtonElement>("abort"),
};

const PHASE_LABEL: Record<GuestPhase["phase"], string> = {
	connecting: "Connecting…",
	syncing: "Loading transcript…",
	live: "Live",
	reconnecting: "Reconnecting…",
	ended: "Disconnected",
};
const STATUS_LABEL: Record<RosterHost["status"], string> = {
	working: "working",
	idle: "idle",
	"needs-input": "needs input",
	unknown: "status unknown",
};

const state = {
	hosts: [] as RosterHost[],
	selected: decodeURIComponent(location.hash.slice(1)) || null,
	phase: null as GuestPhase | null,
	/** Last known roster row for the selection, kept after the host vanishes so the header stays readable. */
	selectedHost: null as RosterHost | null,
	itemNodes: new Map<string, HTMLLIElement>(),
};

let socket: WebSocket | null = null;
let retryMs = 500;

function connect(): void {
	const ws = new WebSocket(`ws://${location.host}/ws`);
	socket = ws;
	ws.onopen = () => {
		retryMs = 500;
		els.connection.hidden = true;
		if (state.selected) sendMsg({ t: "watch", instanceId: state.selected });
	};
	ws.onmessage = event => onServerMsg(JSON.parse(String(event.data)) as ServerMsg);
	ws.onclose = () => {
		socket = null;
		els.connection.hidden = false;
		els.connection.textContent = "Lost the dashboard server. Retrying…";
		setTimeout(connect, retryMs);
		retryMs = Math.min(retryMs * 2, 5000);
	};
}

function sendMsg(msg: ClientMsg): void {
	if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function onServerMsg(msg: ServerMsg): void {
	switch (msg.t) {
		case "hello":
			els.version.textContent = `omp v${msg.ompVersion}`;
			return;
		case "roster":
			state.hosts = msg.hosts;
			els.rosterError.hidden = msg.error === null;
			els.rosterError.textContent = msg.error ? `Registry error: ${msg.error}` : "";
			if (state.selected) state.selectedHost = msg.hosts.find(h => h.instanceId === state.selected) ?? state.selectedHost;
			render();
			return;
		case "phase":
			if (msg.instanceId !== state.selected) return;
			state.phase = msg.phase;
			render();
			return;
		case "items":
			if (msg.instanceId !== state.selected) return;
			applyItems(msg.reset, msg.items);
			return;
	}
}

function select(instanceId: string): void {
	if (instanceId === state.selected) return;
	state.selected = instanceId;
	state.selectedHost = state.hosts.find(h => h.instanceId === instanceId) ?? null;
	state.phase = null;
	history.replaceState(null, "", `#${encodeURIComponent(instanceId)}`);
	applyItems(true, []);
	sendMsg({ t: "watch", instanceId });
	render();
	els.prompt.focus();
}

function age(startedAt: number): string {
	const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
	if (minutes < 60) return `${minutes}m`;
	if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	return `${Math.floor(minutes / 1440)}d`;
}

const hostLabel = (host: RosterHost): string => host.sessionName ?? host.cwdDisplay.split("/").filter(Boolean).pop() ?? host.cwdDisplay;

function renderRoster(): void {
	const rows = state.hosts.map(host => {
		const li = document.createElement("li");
		const button = document.createElement("button");
		button.className = "host";
		button.type = "button";
		button.setAttribute("aria-current", String(host.instanceId === state.selected));
		button.title = `${host.cwd}\npid ${host.pid} · ${host.participants} participant(s)${host.relayConnected ? "" : " · relay offline"}`;
		button.onclick = () => select(host.instanceId);

		const dot = document.createElement("span");
		dot.className = "dot";
		dot.dataset.status = host.status;
		dot.setAttribute("role", "img");
		dot.setAttribute("aria-label", STATUS_LABEL[host.status]);

		const name = document.createElement("span");
		name.className = "host-name";
		name.textContent = hostLabel(host);

		const ageEl = document.createElement("span");
		ageEl.className = "host-age muted";
		ageEl.textContent = age(host.startedAt);

		const detail = document.createElement("span");
		detail.className = "host-detail muted";
		const extras = [host.model ?? "no model", STATUS_LABEL[host.status]];
		if (host.participants > 1) extras.push(`${host.participants - 1} guest${host.participants > 2 ? "s" : ""}`);
		if (!host.relayConnected) extras.push("relay offline");
		detail.textContent = `${host.cwdDisplay} · ${extras.join(" · ")}`;

		button.append(dot, name, ageEl, detail);
		li.append(button);
		return li;
	});
	els.hosts.replaceChildren(...rows);
}

function render(): void {
	renderRoster();
	const live = state.hosts.find(h => h.instanceId === state.selected) ?? null;
	const host = live ?? state.selectedHost;
	els.empty.hidden = state.hosts.length > 0 || host !== null;
	els.placeholder.hidden = state.hosts.length === 0 || host !== null;
	els.session.hidden = host === null;
	if (!host) return;

	els.name.textContent = hostLabel(host);
	els.meta.textContent = `${host.cwdDisplay} · ${host.model ?? "no model"} · pid ${host.pid}`;
	const phase: GuestPhase = live ? (state.phase ?? { phase: "connecting" }) : { phase: "ended", reason: "This session is no longer running." };
	els.phase.dataset.phase = phase.phase;
	let label = PHASE_LABEL[phase.phase];
	if (phase.phase === "live") label = `${phase.readOnly ? "Live, read-only" : "Live"} · ${STATUS_LABEL[host.status]}`;
	if (phase.phase === "ended" || phase.phase === "reconnecting") label += ` · ${phase.reason}`;
	els.phase.textContent = label;

	const writable = live !== null && phase.phase === "live" && !phase.readOnly;
	els.prompt.disabled = !writable;
	els.send.disabled = !writable;
	els.abort.disabled = !writable || host.status !== "working";
}

function fillItem(node: HTMLLIElement, item: Item): void {
	node.className = `item ${item.kind}`;
	switch (item.kind) {
		case "user": {
			node.replaceChildren();
			if (item.from) {
				const from = document.createElement("span");
				from.className = "from";
				from.textContent = item.from;
				node.append(from);
			}
			node.append(item.text);
			return;
		}
		case "assistant":
			node.dataset.streaming = String(item.streaming);
			node.textContent = item.text;
			return;
		case "tool": {
			node.dataset.status = item.status;
			const mark = document.createElement("span");
			mark.className = "tool-mark";
			mark.textContent = item.status === "running" ? "●" : item.status === "error" ? "✕" : "✓";
			const name = document.createElement("span");
			name.className = "tool-name";
			name.textContent = item.name;
			const summary = document.createElement("span");
			summary.className = "tool-summary";
			summary.textContent = item.summary;
			node.replaceChildren(mark, name, summary);
			node.title = item.summary;
			return;
		}
		case "notice":
			node.dataset.level = item.level;
			node.textContent = item.text;
			return;
	}
}

function applyItems(reset: boolean, items: Item[]): void {
	const list = els.transcript;
	const pinned = reset || list.scrollHeight - list.scrollTop - list.clientHeight < 80;
	if (reset) {
		state.itemNodes.clear();
		list.replaceChildren();
	}
	for (const item of items) {
		let node = state.itemNodes.get(item.id);
		if (!node) {
			node = document.createElement("li");
			state.itemNodes.set(item.id, node);
			list.append(node);
		}
		fillItem(node, item);
	}
	if (pinned) list.scrollTop = list.scrollHeight;
}

els.composer.onsubmit = event => {
	event.preventDefault();
	const text = els.prompt.value;
	if (!state.selected || !text.trim() || els.send.disabled) return;
	sendMsg({ t: "prompt", instanceId: state.selected, text });
	els.prompt.value = "";
};
els.prompt.onkeydown = event => {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		els.composer.requestSubmit();
	}
};
els.abort.onclick = () => {
	if (state.selected) sendMsg({ t: "abort", instanceId: state.selected });
};

setInterval(renderRoster, 30_000);
render();
connect();
