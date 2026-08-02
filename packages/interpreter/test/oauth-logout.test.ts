import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Interp, prelude, run, str } from "../src/lisp.ts";

// Point the broker's file store at a temp dir before it starts (the worker
// inherits process.env when spawned on the first MCP call).
const dir = mkdtempSync(join(tmpdir(), "lisptc-logout-"));
process.env.LISPTC_OAUTH_DIR = dir;

describe("logout", () => {
	const interp = new Interp();
	run(interp, prelude);

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("deletes a server's saved OAuth session via the store", () => {
		// The file the FileOAuthStore uses for the posthog origin.
		const file = join(dir, "https___mcp.posthog.com.json");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			file,
			JSON.stringify({ tokens: { access_token: "x", token_type: "Bearer" } }),
		);
		expect(existsSync(file)).toBe(true);

		expect(str(run(interp, '(logout "posthog")'))).toBe(":logged-out");
		expect(existsSync(file)).toBe(false);
	});

	it("errors for an unknown server", () => {
		expect(() => run(interp, '(logout "nope")')).toThrow(/unknown/);
	});
});
