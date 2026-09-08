import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Interp, prelude, runAsync, runSync, str } from "../src/lisp.ts";
import { mcpExtension } from "../src/mcp.ts";

const dir = mkdtempSync(join(tmpdir(), "lisptc-logout-"));
process.env.LISPTC_OAUTH_DIR = dir;

describe("logout", () => {
	const interp = new Interp({ extensions: [mcpExtension()] });
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("deletes a server's saved OAuth session via the store", async () => {
		const file = join(dir, "https___mcp.posthog.com.json");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			file,
			JSON.stringify({ tokens: { access_token: "x", token_type: "Bearer" } }),
		);
		expect(existsSync(file)).toBe(true);

		expect(str((await runAsync(interp, '(logout "posthog")')).value)).toBe(
			":logged-out",
		);
		expect(existsSync(file)).toBe(false);
	});

	it("errors for an unknown server", async () => {
		await expect(runAsync(interp, '(logout "nope")')).rejects.toThrow(
			/unknown/,
		);
	});
});

describe("login", () => {
	const interp = new Interp({ extensions: [mcpExtension()] });
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("returns :logged-in when a token is already stored", async () => {
		const file = join(dir, "https___mcp.linear.app.json");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			file,
			JSON.stringify({ tokens: { access_token: "x", token_type: "Bearer" } }),
		);
		expect(str((await runAsync(interp, '(login "linear")')).value)).toBe(
			":logged-in",
		);
	});

	it("errors for an unknown server", async () => {
		await expect(runAsync(interp, '(login "nope")')).rejects.toThrow(/unknown/);
	});
});
