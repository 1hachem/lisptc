import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRepl } from "../src/repl.ts";

// How the embeddable AgentRepl treats the secret registry across a reset() and
// what it does (and doesn't) auto-load. The secret registry itself is covered
// by the interpreter package; these cases exercise the REPL front-end, which
// lives here.

function writeEnvFile(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "lisptc-secrets-"));
	const path = join(dir, ".env");
	writeFileSync(path, contents);
	return path;
}

describe("AgentRepl secret handling", () => {
	it("re-injects explicitly-loaded secrets on reset()", () => {
		const path = writeEnvFile("REPL_FOO=bar\n");
		const repl = new AgentRepl();
		repl.loadSecretsFromFile(path);
		expect(repl.eval("(secrets)")).toContain("REPL_FOO");
		repl.reset();
		expect(repl.eval("(secrets)")).toContain("REPL_FOO");
	});

	it("keeps descriptions across a reset()", () => {
		const repl = new AgentRepl();
		repl.setSecrets({
			REPL_FOO: { value: "bar", description: "the foo token" },
		});
		expect(repl.eval("(secrets)")).toContain("the foo token");
		repl.reset();
		expect(repl.eval("(secrets)")).toContain("the foo token");
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
});
