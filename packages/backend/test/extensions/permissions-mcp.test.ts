import { mcpExtension } from "@repo/mcp-extension";
import { mcpHost } from "@repo/mcp-extension/mcp-host";
import { permissionsExtension } from "@repo/permissions-extension";
import { textPermissionsHost } from "@repo/permissions-extension/host";
import { promisesExtension } from "@repo/promises-extension";
import { promisesHost } from "@repo/promises-extension/host";
import { MemoryRepl } from "@repo/repl/repl";
import { describe, expect, it } from "vitest";
import { mockMcpClient } from "./helpers.ts";

const CONFIG = `
(permission/server fx
  (ask send_*)
  (deny drop :reason "never drop")
  (hide admin_*))
(permission/hide-server secret-fx)
`;

function replWith(config: string) {
	const client = mockMcpClient({
		fx: { tools: ["echo", "send_mail", "drop", "admin_reset"] },
		"secret-fx": { tools: ["echo"] },
	});
	const permissions = permissionsExtension(textPermissionsHost(config));
	const repl = new MemoryRepl({
		extensions: [
			permissions,
			promisesExtension(promisesHost),
			mcpExtension({ ...mcpHost, client, policy: permissions.rules }),
		],
	});
	return { repl, client };
}

const LOAD = '(echo (await (load-mcp :name "fx" :command "node")))';

async function printed(repl: MemoryRepl, code: string): Promise<string> {
	return (await repl.evalOutput(code)).user;
}

describe("permissions over a loaded MCP server", () => {
	it("narrows a server from the repl before it loads", async () => {
		const { repl } = replWith("(permission/allow permission/server)");
		await repl.eval("(permission/server fx (only echo))");
		const tools = await printed(repl, LOAD);
		expect(tools).toContain("fx/echo");
		expect(tools).not.toContain("send_mail");
		expect(tools).not.toContain("drop");
	});

	it("blocks a loaded tool the repl hides afterwards", async () => {
		const { repl, client } = replWith("(permission/allow permission/server)");
		await repl.eval(LOAD);
		await repl.eval("(permission/server fx (hide echo))");
		expect((await repl.evalOutput('(fx/echo :message "x")')).failed).toBe(true);
		expect(client.calls).toEqual([]);
	});

	it("applies a server change from the repl the moment the user approves it", async () => {
		const { repl, client } = replWith("");
		await repl.eval(LOAD);
		const asked = await repl.evalOutput("(permission/server fx (hide echo))");
		expect(asked.held).toBe(true);
		const { requests } = asked.annotations.output.permissions as {
			requests: { id: string; change?: true }[];
		};
		expect(requests).toEqual([expect.objectContaining({ change: true })]);
		expect(await printed(repl, '(echo (fx/echo :message "x"))')).toContain("x");

		const decided = await repl.invokeUi("permissions/decide", {
			id: requests[0].id,
			approved: true,
			scope: "once",
		});
		expect(decided.message).toContain(
			"it is applied to the permissions config",
		);
		expect((await repl.evalOutput('(fx/echo :message "y")')).failed).toBe(true);
		expect(client.calls.map((c) => c.tool)).toEqual(["echo"]);
	});

	it("never binds a hidden tool, and leaves the rest callable", async () => {
		const { repl } = replWith(CONFIG);
		const tools = await printed(repl, LOAD);
		expect(tools).toContain("fx/echo");
		expect(tools).not.toContain("admin_reset");
		expect(await printed(repl, '(echo (fx/echo :message "hi"))')).toContain(
			"hi",
		);
		expect((await repl.evalOutput("(fx/admin_reset)")).failed).toBe(true);
	});

	it("refuses a denied tool before it reaches the server", async () => {
		const { repl, client } = replWith(CONFIG);
		await repl.eval(LOAD);
		const out = await repl.evalOutput('(fx/drop :message "x")');
		expect(out.failed).toBe(true);
		expect(out.model).toContain("never drop");
		expect(client.calls.map((c) => c.tool)).not.toContain("drop");
	});

	it("treats a hidden server as one that does not exist", async () => {
		const { repl } = replWith(CONFIG);
		const out = await repl.evalOutput(
			'(await (load-mcp :name "secret-fx" :command "node"))',
		);
		expect(out.failed).toBe(true);
		expect(out.model).toContain("unknown MCP server");
	});

	it("asks for a tool, and runs it once the user approves through the ui action", async () => {
		const { repl, client } = replWith(CONFIG);
		await repl.eval(LOAD);
		const asked = await repl.evalOutput('(fx/send_mail :message "hello")');
		expect(asked.failed).toBe(false);
		expect(asked.held).toBe(true);
		const { requests } = asked.annotations.output.permissions as {
			requests: { id: string; name: string }[];
		};
		expect(requests.map((r) => r.name)).toEqual(["fx/send_mail"]);
		expect(client.calls).toEqual([]);

		const decided = await repl.invokeUi("permissions/decide", {
			id: requests[0].id,
			approved: true,
			scope: "once",
		});
		expect(decided.failed).toBe(false);
		expect(decided.message).toContain("approved fx/send_mail");

		expect(
			await printed(repl, '(echo (fx/send_mail :message "hello"))'),
		).toContain("hello");
		expect(client.calls.map((c) => c.tool)).toEqual(["send_mail"]);
	});
});
