import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { afterAll, describe, expect, it } from "vitest";
import { mcpExtension } from "../src/mcp.ts";
import { mcpHostFor } from "../src/mcp-host.ts";
import { MemoryOAuthStore } from "../src/oauth-host.ts";

const token = { tokens: { access_token: "x", token_type: "Bearer" } };

describe("logout", () => {
	const oauth = new MemoryOAuthStore();
	const interp = new Interp({
		extensions: [mcpExtension(mcpHostFor({ oauth }))],
	});
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("deletes a server's saved OAuth session via the store", async () => {
		await oauth.save("https://mcp.posthog.com", token);

		expect(str((await runAsync(interp, '(logout "posthog")')).value)).toBe(
			":logged-out",
		);
		expect(await oauth.load("https://mcp.posthog.com")).toBeUndefined();
	});

	it("errors for an unknown server", async () => {
		await expect(runAsync(interp, '(logout "nope")')).rejects.toThrow(
			/unknown/,
		);
	});
});

describe("login", () => {
	const oauth = new MemoryOAuthStore();
	const interp = new Interp({
		extensions: [mcpExtension(mcpHostFor({ oauth }))],
	});
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("returns :logged-in when a token is already stored", async () => {
		await oauth.save("https://mcp.linear.app", token);
		expect(str((await runAsync(interp, '(login "linear")')).value)).toBe(
			":logged-in",
		);
	});

	it("errors for an unknown server", async () => {
		await expect(runAsync(interp, '(login "nope")')).rejects.toThrow(/unknown/);
	});
});
