import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	killSession,
	SessionClient,
	socketPathFor,
} from "@repo/repl/session-server";
import { afterEach, describe, expect, it } from "vitest";

const SERVER = fileURLToPath(new URL("../src/server.ts", import.meta.url));

interface Lsp {
	request(method: string, params: unknown): Promise<unknown>;
	notify(method: string, params: unknown): void;
	process: ChildProcess;
}

function startLsp(cwd: string): Lsp {
	const child = spawn(
		process.execPath,
		["--no-warnings", "--experimental-transform-types", SERVER, "--stdio"],
		{ cwd, stdio: ["pipe", "pipe", "ignore"] },
	);
	const pending = new Map<number, (result: unknown) => void>();
	let nextId = 1;
	let buffer = Buffer.alloc(0);
	child.stdout?.on("data", (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			const end = buffer.indexOf("\r\n\r\n");
			if (end === -1) return;
			const length = Number(
				/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1],
			);
			if (buffer.length < end + 4 + length) return;
			const message = JSON.parse(
				buffer.subarray(end + 4, end + 4 + length).toString(),
			) as { id?: number; result?: unknown };
			buffer = buffer.subarray(end + 4 + length);
			if (message.id !== undefined) pending.get(message.id)?.(message.result);
		}
	});
	const write = (message: object) => {
		const body = JSON.stringify({ jsonrpc: "2.0", ...message });
		child.stdin?.write(
			`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
		);
	};
	return {
		process: child,
		request(method, params) {
			const id = nextId++;
			return new Promise((resolve) => {
				pending.set(id, resolve);
				write({ id, method, params });
			});
		},
		notify(method, params) {
			write({ method, params });
		},
	};
}

async function until<T>(attempt: () => Promise<T | undefined>): Promise<T> {
	const deadline = Date.now() + 30_000;
	for (;;) {
		const value = await attempt().catch(() => undefined);
		if (value !== undefined) return value;
		if (Date.now() > deadline) throw new Error("timed out");
		await new Promise((r) => setTimeout(r, 200));
	}
}

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
	await cleanup?.();
	cleanup = undefined;
});

describe("completion over the protocol", () => {
	it("offers a name defined in the shared session once that session is up", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "lisptc-lsp-")));
		const lsp = startLsp(dir);
		cleanup = async () => {
			lsp.process.kill();
			await killSession(dir);
			rmSync(dir, { recursive: true, force: true });
		};
		const uri = `file://${dir}/scratch.ptc`;
		await lsp.request("initialize", {
			processId: null,
			rootUri: null,
			capabilities: {},
		});
		lsp.notify("initialized", {});
		lsp.notify("textDocument/didOpen", {
			textDocument: { uri, languageId: "lisptc", version: 1, text: "(my-wid" },
		});
		const labels = async () => {
			const result = (await lsp.request("textDocument/completion", {
				textDocument: { uri },
				position: { line: 0, character: 7 },
			})) as { label: string }[] | { items: { label: string }[] };
			const items = Array.isArray(result) ? result : result.items;
			return items.map((item) => item.label);
		};

		expect(await labels()).not.toContain("my-widget");

		const session = await until(() =>
			SessionClient.connect(socketPathFor(dir)),
		);
		await session.eval("(setq my-widget 1)");
		session.close();

		expect(
			await until(async () =>
				(await labels()).includes("my-widget") ? true : undefined,
			),
		).toBe(true);
	}, 60_000);
});
