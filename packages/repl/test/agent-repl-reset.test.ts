import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvSecretsStore } from "@repo/interpreter/secrets.ts";
import { describe, expect, it } from "vitest";
import { AgentRepl } from "../src/repl.ts";

// How the embeddable AgentRepl treats the secret registry: it exposes `REPL_*`
// env-var secrets (seeded by the addon) but does NOT auto-load a `.env` file —
// that is CLI-only. The store is the REPL's, held across resets, so a host can
// inject into it via `repl.secrets` (or hand one over at construction). The
// registry itself is covered by the interpreter package; these cases exercise
// the REPL front-end.

function writeEnvFile(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "lisptc-secrets-"));
	const path = join(dir, ".env");
	writeFileSync(path, contents);
	return path;
}

describe("AgentRepl secret handling", () => {
	it("exposes REPL_* env-var secrets", () => {
		const prev = process.env.REPL_ENV_TOKEN;
		process.env.REPL_ENV_TOKEN = "tok";
		try {
			const repl = new AgentRepl();
			expect(repl.eval("(secrets)")).toContain("REPL_ENV_TOKEN");
		} finally {
			if (prev === undefined) delete process.env.REPL_ENV_TOKEN;
			else process.env.REPL_ENV_TOKEN = prev;
		}
	});

	it("does not auto-load $LISPTC_SECRETS_FILE for an embedded AgentRepl", () => {
		const path = writeEnvFile("REPL_PI_TOKEN=t0ken\n");
		const prev = process.env.LISPTC_SECRETS_FILE;
		process.env.LISPTC_SECRETS_FILE = path;
		try {
			const repl = new AgentRepl();
			expect(repl.eval("(secrets)")).not.toContain("REPL_PI_TOKEN");
		} finally {
			if (prev === undefined) delete process.env.LISPTC_SECRETS_FILE;
			else process.env.LISPTC_SECRETS_FILE = prev;
		}
	});

	it("lets a host inject secrets that survive reset()", () => {
		const repl = new AgentRepl();
		repl.secrets.set({
			REPL_HOST_TOKEN: { value: "h0st", description: "from host" },
		});
		expect(repl.eval('(secret "REPL_HOST_TOKEN")')).toContain(
			"#<secret:REPL_HOST_TOKEN>",
		);
		repl.reset();
		// The store outlives the interp, so the injection is still there.
		expect(repl.eval('(secret "REPL_HOST_TOKEN")')).toContain(
			"#<secret:REPL_HOST_TOKEN>",
		);
		expect(repl.eval("(secrets)")).toContain("from host");
	});

	it("uses a store handed in at construction", () => {
		const store = new EnvSecretsStore();
		store.set({ REPL_SHARED_TOKEN: "shared" });
		const repl = new AgentRepl({ secretsStore: store });
		expect(repl.eval('(secret "REPL_SHARED_TOKEN")')).toContain(
			"#<secret:REPL_SHARED_TOKEN>",
		);
	});
});
