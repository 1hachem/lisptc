import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Interp, prelude, runAsync, runSync, str } from "../src/lisp.ts";
import { mcpExtension, specFromConfig } from "../src/mcp.ts";
import {
	createLocalRuntime,
	type Endpoint,
	type Instance,
	type McpRuntime,
	type ServerSpec,
} from "../src/mcp-runtime.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

const FIXTURE_ENDPOINT: Endpoint = {
	transport: "stdio",
	command: "node",
	args: ["--no-warnings", "--experimental-transform-types", FIXTURE],
};

function port(): number {
	return 8940 + Math.floor(Math.random() * 40);
}

async function evalStr(interp: Interp, code: string): Promise<string> {
	return str((await runAsync(interp, code)).value);
}

describe("specFromConfig", () => {
	it("reads a bare url entry as a remote server", () => {
		const spec = specFromConfig({
			name: "linear",
			url: "https://mcp.linear.app/mcp",
			oauth: true,
			scopes: ["read"],
		});
		expect(spec).toEqual({
			origin: "remote",
			name: "linear",
			url: "https://mcp.linear.app/mcp",
			headers: undefined,
			oauth: true,
			scopes: ["read"],
		});
	});

	it("reads a url entry that also carries a command as a program", () => {
		const spec = specFromConfig({
			name: "sheets",
			url: "http://localhost:8911/mcp",
			command: "task",
			args: ["mcp:sheets"],
		});
		expect(spec.origin).toBe("program");
		expect(spec).toMatchObject({
			command: "task",
			url: "http://localhost:8911/mcp",
		});
	});

	it("reads a command entry as a program with no url", () => {
		const spec = specFromConfig({
			name: "fs",
			command: "npx",
			args: ["-y", "x"],
		});
		expect(spec).toMatchObject({ origin: "program", command: "npx" });
		expect("url" in spec ? spec.url : undefined).toBeUndefined();
	});
});

describe("the local runtime", () => {
	const instance: Instance = { sessionId: "test", server: "fx" };

	it("hands a stdio endpoint back for a program with no url", async () => {
		const endpoint = await createLocalRuntime().start(
			{ origin: "program", name: "fx", command: "node", args: ["-e", ""] },
			instance,
		);
		expect(endpoint.transport).toBe("stdio");
		expect(endpoint).toMatchObject({ command: "node", args: ["-e", ""] });
	});

	it("passes the spec's env on top of the parent environment", async () => {
		const endpoint = await createLocalRuntime().start(
			{
				origin: "program",
				name: "fx",
				command: "node",
				env: { LISPTC_RUNTIME_PROBE: "1" },
			},
			instance,
		);
		if (endpoint.transport !== "stdio") throw new Error("expected stdio");
		expect(endpoint.env?.LISPTC_RUNTIME_PROBE).toBe("1");
		expect(endpoint.env?.PATH).toBe(process.env.PATH);
	});

	it("hands an http endpoint back for a remote server without starting anything", async () => {
		const endpoint = await createLocalRuntime().start(
			{
				origin: "remote",
				name: "linear",
				url: "https://mcp.linear.app/mcp",
				oauth: true,
			},
			{ sessionId: "test", server: "linear" },
		);
		expect(endpoint).toEqual({
			transport: "http",
			url: "https://mcp.linear.app/mcp",
			headers: undefined,
			oauth: true,
			scopes: undefined,
		});
	});

	it("starts a url server, waits for it to answer, and stops it by session", async () => {
		const runtime = createLocalRuntime();
		const url = `http://127.0.0.1:${port()}/mcp`;
		const origin = new URL(url).origin;
		const spec: ServerSpec = {
			origin: "program",
			name: "http-fx",
			url,
			command: process.execPath,
			args: [
				"-e",
				`require("node:http").createServer((_, res) => res.end("ok")).listen(${new URL(url).port})`,
			],
		};
		const target: Instance = { sessionId: "runtime-test", server: "http-fx" };

		const endpoint = await runtime.start(spec, target);
		expect(endpoint).toMatchObject({ transport: "http", url });
		expect(
			(await fetch(origin, { signal: AbortSignal.timeout(2000) })).ok,
		).toBe(true);

		await runtime.stopAll("runtime-test");
		await new Promise((resolve) => setTimeout(resolve, 200));
		await expect(
			fetch(origin, { signal: AbortSignal.timeout(2000) }),
		).rejects.toThrow();
	});

	it("reports why a url server died before its port answered", async () => {
		const runtime = createLocalRuntime();
		await expect(
			runtime.start(
				{
					origin: "program",
					name: "doomed",
					url: `http://127.0.0.1:${port()}/mcp`,
					command: process.execPath,
					args: ["-e", 'console.error("no credentials"); process.exit(1)'],
				},
				{ sessionId: "runtime-test", server: "doomed" },
			),
		).rejects.toThrow(
			/doomed: its server exited with code 1[\s\S]*no credentials/,
		);
	});
});

describe("an injected runtime", () => {
	it("is what load-mcp connects through, and receives the session's instance", async () => {
		const seen: Array<{ spec: ServerSpec; instance: Instance }> = [];
		const stopped: string[] = [];
		const runtime: McpRuntime = {
			async start(spec, instance) {
				seen.push({ spec, instance });
				return FIXTURE_ENDPOINT;
			},
			async stop() {},
			async stopAll(sessionId) {
				stopped.push(sessionId);
			},
		};
		const interp = new Interp({
			extensions: [mcpExtension({ runtime, sessionId: "thread-7" })],
		});
		runSync(interp, prelude);

		const tools = await evalStr(
			interp,
			'(await (load-mcp :name "fx" :command "never-run"))',
		);
		expect(tools).toContain("fx/echo");
		expect(await evalStr(interp, '(fx/echo :message "hi")')).toBe('"hi"');
		expect(seen).toHaveLength(1);
		expect(seen[0].spec).toMatchObject({
			origin: "program",
			name: "fx",
			command: "never-run",
		});
		expect(seen[0].instance).toEqual({ sessionId: "thread-7", server: "fx" });

		await runAsync(interp, "(mcp-shutdown)");
		expect(stopped).toEqual(["thread-7"]);
	});

	it("stops the session's servers when the interpreter is disposed", async () => {
		const stopped: string[] = [];
		const runtime: McpRuntime = {
			async start() {
				return FIXTURE_ENDPOINT;
			},
			async stop() {},
			async stopAll(sessionId) {
				stopped.push(sessionId);
			},
		};
		const interp = new Interp({
			extensions: [mcpExtension({ runtime, sessionId: "thread-8" })],
		});
		interp.dispose();
		expect(stopped).toEqual(["thread-8"]);
	});
});
