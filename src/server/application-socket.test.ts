import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The DOM constructor type hides Bun's documented client header/protocol options.
declare const WebSocket: { new(url: string, options: Bun.WebSocketOptions): globalThis.WebSocket };

test("the application authenticates its browser socket and sends a roster without echoing credentials", async () => {
	const dir = await mkdtemp(join(tmpdir(), "omp-socket-"));
	const port = 20_000 + Math.floor(Math.random() * 20_000);
	const reservation = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
	reservation.stop(true);
	const origin = `http://127.0.0.1:${port}`;
	const server = Bun.spawn([process.execPath, "src/server.ts"], {
		cwd: join(import.meta.dir, "../.."),
		env: { ...process.env, PORT: String(port), OMP_AGENTS_PARENT: "", XDG_CONFIG_HOME: join(dir, "config"), XDG_DATA_HOME: join(dir, "data") },
		stdout: "pipe",
		stderr: "pipe",
	});
	const ready = Promise.withResolvers<void>();
	// Startup is a subprocess signal, with a real-time bound so a hung child is still stopped in finally.
	const startupDeadline = AbortSignal.timeout(45_000);
	startupDeadline.onabort = () => ready.reject(new Error("Application did not finish starting"));
	const stdout = (async () => {
		let output = "";
		for await (const chunk of server.stdout) {
			output += new TextDecoder().decode(chunk);
			if (output.includes("The access token is in")) ready.resolve();
		}
		return output;
	})();
	const stderr = new Response(server.stderr).text();
	let socket: WebSocket | undefined;
	try {
		await Promise.race([
			ready.promise,
			server.exited.then(async code => {
				throw new Error(`Application exited (${code}): ${await stdout}\n${await stderr}`);
			}),
		]);
		startupDeadline.onabort = null;
		const token = (await readFile(join(dir, "config/omp-agents/token"), "utf8")).trim();
		const headers = { Origin: origin, Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": Buffer.alloc(16).toString("base64"), "Sec-WebSocket-Version": "13" };
		expect((await fetch(`${origin}/ws`, { headers })).status).toBe(401);
		expect((await fetch(`${origin}/ws`, { headers: { ...headers, Origin: "http://evil.test", Authorization: `Bearer ${token}` } })).status).toBe(403);
		socket = new WebSocket(`${origin.replace("http:", "ws:")}/ws?page=${crypto.randomUUID()}`, { protocols: ["omp-agents", `bearer.${token}`], headers: { Origin: origin } });
		const connected = socket;
		const roster = Promise.withResolvers<{ t: string; reset: boolean }>();
		// The subprocess uses real network I/O; bound a missing frame instead of guessing a settling delay.
		const deadline = AbortSignal.timeout(10_000);
		deadline.onabort = () => roster.reject(new Error("Authenticated socket never received its initial roster"));
		connected.onmessage = event => {
			try {
				const message = JSON.parse(String(event.data));
				if (message.t === "roster" && message.reset) roster.resolve(message);
			} catch (error) {
				roster.reject(error);
			}
		};
		connected.onerror = () => roster.reject(new Error("Application socket handshake failed"));
		connected.onclose = () => roster.reject(new Error("Application socket closed before the roster"));
		expect(await roster.promise.finally(() => { deadline.onabort = null; })).toMatchObject({ t: "roster", reset: true });
		expect(connected.protocol).toBe("omp-agents");
	} finally {
		startupDeadline.onabort = null;
		socket?.close();
		server.kill();
		await server.exited;
		await Promise.all([stdout, stderr]);
		await rm(dir, { recursive: true, force: true });
	}
}, 60_000);
