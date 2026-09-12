import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { replEnv } from "@repo/env/repl";
import type { Arity, DocArg } from "@repo/interpreter/lisp";
import { MemoryRepl } from "./repl.ts";

export interface CompletionEntry {
	name: string;
	signature?: string;
	doc?: string;
}

export interface DocEntry {
	signature: string;
	doc: string;
	args?: DocArg[];
	arity?: Arity;
}

interface Request {
	id: number;
	op: "eval" | "completions" | "doc" | "reset" | "shutdown" | "version";
	code?: string;
	symbol?: string;
}

export const PROTOCOL_VERSION = 1;

interface Reply {
	id: number;
	ok: boolean;
	result?: unknown;
	error?: string;
}

export function socketPathFor(session?: string): string {
	const id = session ?? replEnv.LISPTC_SESSION ?? process.cwd();
	const hash = createHash("sha256").update(id).digest("hex").slice(0, 16);
	const dir = replEnv.XDG_RUNTIME_DIR ?? tmpdir();
	return join(dir, `lisptc-${hash}.sock`);
}

async function respond(
	socket: Socket,
	repl: MemoryRepl,
	line: string,
	shutdown: () => void,
): Promise<void> {
	let reply: Reply;
	let req: Request | undefined;
	try {
		req = JSON.parse(line) as Request;
		reply = { id: req.id, ok: true, result: await handle(repl, req) };
	} catch (ex) {
		reply = { id: safeId(line), ok: false, error: String(ex) };
	}
	socket.write(`${JSON.stringify(reply)}\n`, () => {
		if (req?.op === "shutdown") shutdown();
	});
}

async function handle(repl: MemoryRepl, req: Request): Promise<unknown> {
	switch (req.op) {
		case "eval":
			return repl.eval(req.code ?? "");
		case "reset":
			repl.reset();
			return "";
		case "shutdown":
			return "";
		case "version":
			return PROTOCOL_VERSION;
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

export async function serve(
	path: string,
): Promise<ReturnType<typeof createServer>> {
	if (existsSync(path)) {
		if (await isListening(path)) {
			throw Object.assign(
				new Error(
					`EADDRINUSE: a session server is already listening on ${path}`,
				),
				{ code: "EADDRINUSE" },
			);
		}
		try {
			unlinkSync(path);
		} catch {}
	}

	const repl = new MemoryRepl();

	const server = createServer((socket: Socket) => {
		let buffer = "";
		let pending: Promise<void> = Promise.resolve();
		socket.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			let nl = buffer.indexOf("\n");
			while (nl !== -1) {
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (line.trim() !== "")
					pending = pending.then(() => respond(socket, repl, line, shutdown));
				nl = buffer.indexOf("\n");
			}
		});
		socket.on("error", () => socket.destroy());
	});

	const shutdown = (): void => {
		server.close();
		try {
			unlinkSync(path);
		} catch {}
		process.exit(0);
	};

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => resolve(server));
	});
}

function safeId(line: string): number {
	try {
		const v = JSON.parse(line) as { id?: number };
		return typeof v.id === "number" ? v.id : 0;
	} catch {
		return 0;
	}
}

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
	version(): Promise<number> {
		return this.send({ op: "version" }) as Promise<number>;
	}

	close(): void {
		this.socket.end();
	}

	destroy(): void {
		this.socket.destroy();
	}
}

async function shutdownAt(path: string): Promise<boolean> {
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
		await client.shutdown();
		return true;
	} catch {
		return false;
	} finally {
		client.destroy();
	}
}

export function killSession(session?: string): Promise<boolean> {
	return shutdownAt(socketPathFor(session));
}

async function speaksCurrentProtocol(client: SessionClient): Promise<boolean> {
	try {
		return (await client.version()) === PROTOCOL_VERSION;
	} catch {
		return false;
	}
}

export async function connectOrSpawn(path: string): Promise<SessionClient> {
	try {
		const client = await SessionClient.connect(path);
		if (await speaksCurrentProtocol(client)) return client;
		client.destroy();
		if (await shutdownAt(path)) {
			await spawnServer(path);
			return connectWithRetry(path);
		}
		return await SessionClient.connect(path);
	} catch (ex) {
		const code = (ex as NodeJS.ErrnoException).code;
		if (code === "ECONNREFUSED" && existsSync(path)) {
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

const SPAWN_TIMEOUT_MS = 20_000;

async function connectWithRetry(path: string): Promise<SessionClient> {
	const deadline = Date.now() + SPAWN_TIMEOUT_MS;
	let lastErr: unknown;
	do {
		try {
			return await SessionClient.connect(path);
		} catch (ex) {
			lastErr = ex;
			await delay(50);
		}
	} while (Date.now() < deadline);
	throw lastErr instanceof Error
		? lastErr
		: new Error("could not start session");
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

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
			process.exit(0);
		}
		throw ex;
	}
}

main();
