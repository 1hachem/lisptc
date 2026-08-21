/**
 * A shared REPL "session": one long-lived process owns a `MemoryRepl` and
 * serves it to many clients over a unix domain socket, so an editor's LSP and a
 * terminal REPL (nvim + Iron) can talk to the SAME interpreter state. Type
 * `(defun foo ...)` in the terminal and the LSP's completion/hover see `foo`
 * immediately — the classic nREPL model, keyed by project.
 *
 * A live `Interp` is an in-memory object graph and cannot be shared across
 * processes by reference; instead exactly one process owns it (the server) and
 * every other consumer becomes a thin client (`SessionClient`). Clients never
 * construct their own interpreter.
 *
 * Protocol: newline-delimited JSON. Request `{id, op, code?, symbol?}`, reply
 * `{id, ok, result?, error?}`. Ops:
 *   - `eval   {code}`        -> printed output (what the terminal REPL shows)
 *   - `completions {}`       -> [{name, signature, doc}] (LSP completion), LIVE
 *   - `doc    {symbol}`      -> {signature, doc} | null       (LSP hover), LIVE
 *   - `reset  {}`            -> "" ; discards all definitions
 *   - `shutdown {}`          -> "" ; then the server closes its socket and exits
 * `completions`/`doc` only READ the interp (globalNames/docs); they never eval.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Arity, DocArg } from "@repo/interpreter/lisp.ts";
import { MemoryRepl } from "./repl.ts";

export interface CompletionEntry {
	name: string;
	signature?: string;
	doc?: string;
}

export interface DocEntry {
	signature: string;
	doc: string;
	// Structured keyword args (set only for keyword-call bindings, e.g. MCP
	// tools), so the LSP's argument completion doesn't have to re-parse
	// `signature`/`doc`.
	args?: DocArg[];
	// Positional-argument count (set only for the OTHER kind of binding —
	// built-ins/macros/defuns that call positionally rather than by
	// keyword), so the LSP's arity check doesn't have to re-parse `signature`.
	arity?: Arity;
}

interface Request {
	id: number;
	op: "eval" | "completions" | "doc" | "reset" | "shutdown";
	code?: string;
	symbol?: string;
}

interface Reply {
	id: number;
	ok: boolean;
	result?: unknown;
	error?: string;
}

// Resolve the socket path for a session. Default (no LISPTC_SESSION) keys the
// socket on the project root (cwd), so everyone in the same repo shares one
// interpreter automatically; set LISPTC_SESSION=<name> to split off a separate
// one. Honors $XDG_RUNTIME_DIR when present, else falls back to the tmp dir.
export function socketPathFor(session?: string): string {
	const id = session ?? process.env.LISPTC_SESSION ?? process.cwd();
	const hash = createHash("sha256").update(id).digest("hex").slice(0, 16);
	const dir = process.env.XDG_RUNTIME_DIR ?? tmpdir();
	return join(dir, `lisptc-${hash}.sock`);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

// Answer a single request against the owned REPL. Pure dispatch; the transport
// (framing, connections) is handled by `serve`.
function handle(repl: MemoryRepl, req: Request): unknown {
	switch (req.op) {
		case "eval":
			return repl.eval(req.code ?? "");
		case "reset":
			repl.reset();
			return "";
		case "shutdown":
			// The actual teardown (closing the server, exiting the process) is a
			// side effect handled by the caller once this reply is flushed — see
			// the `shutdown` branch in `serve()`.
			return "";
		case "completions": {
			const docs = repl.interp.docs();
			const names = new Set([...repl.interp.globalNames(), ...docs.keys()]);
			const out: CompletionEntry[] = [];
			for (const name of names) {
				if (name.startsWith("_")) continue;
				const d = docs.get(name);
				out.push({ name, signature: d?.signature, doc: d?.doc });
			}
			return out;
		}
		case "doc": {
			const symbol = req.symbol ?? "";
			const d = repl.interp.docs().get(symbol);
			return d
				? {
						signature: d.signature,
						doc: d.doc,
						args: d.args,
						arity: repl.interp.arityOf(symbol),
					}
				: null;
		}
		default:
			throw new Error(`unknown op: ${(req as Request).op}`);
	}
}

// Probe whether a live server is listening at `path`, distinguishing a
// leftover socket file (from a server that crashed without cleaning up, safe
// to delete) from one with a live listener behind it (NOT safe to delete —
// unlinking it out from under a running server orphans it, since a new bind
// at the same path silently steals the name without the old process ever
// knowing). ECONNREFUSED means nobody is listening; anything else (including
// a successful connect) means treat it as live and leave it alone.
function isListening(path: string): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection(path);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", (ex) => {
			resolve((ex as NodeJS.ErrnoException).code !== "ECONNREFUSED");
		});
	});
}

// Start a session server listening on `path`. Owns one MemoryRepl for the
// process lifetime; every connection shares it. Resolves once listening.
export async function serve(
	path: string,
): Promise<ReturnType<typeof createServer>> {
	if (existsSync(path)) {
		if (await isListening(path)) {
			// Someone beat us to it — most likely another spawn racing to bind
			// this same path. Back off rather than steal the name.
			throw Object.assign(
				new Error(
					`EADDRINUSE: a session server is already listening on ${path}`,
				),
				{ code: "EADDRINUSE" },
			);
		}
		// No live listener behind it — a stale file left by a server that
		// crashed without cleaning up. Safe to clear before binding.
		try {
			unlinkSync(path);
		} catch {
			// Already gone; nothing to clean up.
		}
	}

	const repl = new MemoryRepl();

	const server = createServer((socket: Socket) => {
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			let nl = buffer.indexOf("\n");
			while (nl !== -1) {
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (line.trim() !== "") {
					let reply: Reply;
					let req: Request | undefined;
					try {
						req = JSON.parse(line) as Request;
						reply = { id: req.id, ok: true, result: handle(repl, req) };
					} catch (ex) {
						reply = { id: safeId(line), ok: false, error: String(ex) };
					}
					socket.write(`${JSON.stringify(reply)}\n`, () => {
						if (req?.op === "shutdown") shutdown();
					});
				}
				nl = buffer.indexOf("\n");
			}
		});
		socket.on("error", () => socket.destroy());
	});

	// Tears the process down once a shutdown request's reply has flushed, so the
	// client sees the ack before the socket goes away.
	const shutdown = (): void => {
		server.close();
		try {
			unlinkSync(path);
		} catch {
			// Already gone; nothing to clean up.
		}
		process.exit(0);
	};

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => resolve(server));
	});
}

// Best-effort extraction of the request id from a line that failed to dispatch,
// so a malformed-but-parseable request still gets its reply correlated.
function safeId(line: string): number {
	try {
		const v = JSON.parse(line) as { id?: number };
		return typeof v.id === "number" ? v.id : 0;
	} catch {
		return 0;
	}
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

// A thin client over the socket. Multiplexes concurrent requests by id, so the
// LSP can have a completion and a hover in flight at once.
export class SessionClient {
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{ resolve: (v: unknown) => void; reject: (e: Error) => void }
	>();
	private buffer = "";

	private constructor(private readonly socket: Socket) {
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => this.onData(chunk));
		socket.on("close", () => this.failAll(new Error("session socket closed")));
		socket.on("error", (e) => this.failAll(e));
	}

	static connect(path: string): Promise<SessionClient> {
		return new Promise((resolve, reject) => {
			const socket = createConnection(path);
			socket.once("connect", () => resolve(new SessionClient(socket)));
			socket.once("error", reject);
		});
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		let nl = this.buffer.indexOf("\n");
		while (nl !== -1) {
			const line = this.buffer.slice(0, nl);
			this.buffer = this.buffer.slice(nl + 1);
			if (line.trim() !== "") {
				const reply = JSON.parse(line) as Reply;
				const p = this.pending.get(reply.id);
				if (p) {
					this.pending.delete(reply.id);
					if (reply.ok) p.resolve(reply.result);
					else p.reject(new Error(reply.error ?? "session error"));
				}
			}
			nl = this.buffer.indexOf("\n");
		}
	}

	private failAll(err: Error): void {
		for (const { reject } of this.pending.values()) reject(err);
		this.pending.clear();
	}

	private send(req: Omit<Request, "id">): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.socket.write(`${JSON.stringify({ id, ...req })}\n`);
		});
	}

	eval(code: string): Promise<string> {
		return this.send({ op: "eval", code }) as Promise<string>;
	}
	reset(): Promise<string> {
		return this.send({ op: "reset" }) as Promise<string>;
	}
	completions(): Promise<CompletionEntry[]> {
		return this.send({ op: "completions" }) as Promise<CompletionEntry[]>;
	}
	doc(symbol: string): Promise<DocEntry | null> {
		return this.send({ op: "doc", symbol }) as Promise<DocEntry | null>;
	}
	shutdown(): Promise<string> {
		return this.send({ op: "shutdown" }) as Promise<string>;
	}

	close(): void {
		this.socket.end();
	}

	// Immediately release the socket without waiting for a graceful FIN/FIN-ACK
	// handshake, unlike `close`. Use when the remote might never cooperate —
	// e.g. `killSession` cleaning up after a server that rejected (or never
	// answered) the shutdown request; otherwise the handle lingers and the
	// caller's process hangs forever waiting for a "close" that never comes.
	destroy(): void {
		this.socket.destroy();
	}
}

// ---------------------------------------------------------------------------
// Kill: stop a running session server, given its name
// ---------------------------------------------------------------------------

// Shut down the session server for `session` (the same name passed to
// `socketPathFor`/`LISPTC_SESSION`; omit for the default cwd-keyed session),
// so it releases its socket and exits instead of lingering as an orphaned
// detached process. Returns false if no server was running for it — either no
// socket file, or a stale one left behind by a server that already died, in
// which case it's cleaned up here since there's no live server left to do it.
export async function killSession(session?: string): Promise<boolean> {
	const path = socketPathFor(session);
	let client: SessionClient;
	try {
		client = await SessionClient.connect(path);
	} catch (ex) {
		const code = (ex as NodeJS.ErrnoException).code;
		if (code === "ECONNREFUSED" && existsSync(path)) {
			try {
				unlinkSync(path);
			} catch {}
		}
		return false;
	}
	try {
		// The server writes this reply BEFORE closing/exiting (see `serve`), so a
		// resolved promise here means it genuinely shut down — not just that the
		// connection happened to drop. A rejection (e.g. "unknown op: shutdown"
		// from a server started before this op existed) means it's still up.
		await client.shutdown();
		return true;
	} catch {
		return false;
	} finally {
		// Always drop our end, win or lose — otherwise a server that rejects the
		// request (or never replies) leaves this socket open and the caller's
		// process hanging on a handle nothing will ever close.
		client.destroy();
	}
}

// ---------------------------------------------------------------------------
// Connect-or-spawn: the "one by default" glue
// ---------------------------------------------------------------------------

// Connect to the session server for `path`, starting one (detached) if none is
// running. The first client in a project boots the server; the rest attach.
// A stale socket file (server crashed) is cleared and re-spawned.
export async function connectOrSpawn(path: string): Promise<SessionClient> {
	try {
		return await SessionClient.connect(path);
	} catch (ex) {
		const code = (ex as NodeJS.ErrnoException).code;
		if (code === "ECONNREFUSED" && existsSync(path)) {
			// Socket file exists but nothing is listening: a dead server.
			try {
				unlinkSync(path);
			} catch {}
		} else if (code !== "ENOENT" && code !== "ECONNREFUSED") {
			throw ex;
		}
	}
	await spawnServer(path);
	return connectWithRetry(path);
}

const selfPath = fileURLToPath(import.meta.url);

function spawnServer(path: string): Promise<void> {
	const child: ChildProcess = spawn(
		process.execPath,
		[
			"--no-warnings",
			"--experimental-transform-types",
			selfPath,
			"--serve",
			"--socket",
			path,
		],
		{ detached: true, stdio: "ignore" },
	);
	child.unref();
	return Promise.resolve();
}

// Poll for the socket to accept connections after a spawn (the detached server
// takes a moment to bind). Gives up after ~2s.
async function connectWithRetry(path: string): Promise<SessionClient> {
	let lastErr: unknown;
	for (let i = 0; i < 40; i++) {
		try {
			return await SessionClient.connect(path);
		} catch (ex) {
			lastErr = ex;
			await delay(50);
		}
	}
	throw lastErr instanceof Error
		? lastErr
		: new Error("could not start session");
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// Entry point: `node session-server.ts --serve --socket <path>`. Guarded so
// importing the module never starts a server.
async function main(): Promise<void> {
	const entry = process.argv[1];
	if (!entry || import.meta.url !== pathToFileURL(entry).href) return;
	if (!process.argv.includes("--serve")) return;
	const i = process.argv.indexOf("--socket");
	const path = i !== -1 ? process.argv[i + 1] : socketPathFor();
	try {
		await serve(path);
	} catch (ex) {
		if ((ex as NodeJS.ErrnoException).code === "EADDRINUSE") {
			// Lost a spawn race to another server that already claimed this
			// socket; exit quietly rather than linger as an unreachable orphan.
			process.exit(0);
		}
		throw ex;
	}
	// Keep the process alive; the detached parent has unref'd us.
}

main();
