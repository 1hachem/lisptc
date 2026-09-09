import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvSecretsStore } from "@repo/interpreter/secrets";
import { describe, expect, it } from "vitest";
import { AgentRepl } from "../src/repl.ts";

function writeEnvFile(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "lisptc-secrets-"));
	const path = join(dir, ".env");
	writeFileSync(path, contents);
	return path;
}

describe("AgentRepl secret handling", () => {
	it("exposes REPL_* env-var secrets", async () => {
		const prev = process.env.REPL_ENV_TOKEN;
		process.env.REPL_ENV_TOKEN = "tok";
		try {
			const repl = new AgentRepl();
			expect(await repl.eval("(secrets)")).toContain("REPL_ENV_TOKEN");
		} finally {
			if (prev === undefined) delete process.env.REPL_ENV_TOKEN;
			else process.env.REPL_ENV_TOKEN = prev;
		}
	});

	it("does not auto-load $LISPTC_SECRETS_FILE for an embedded AgentRepl", async () => {
		const path = writeEnvFile("REPL_PI_TOKEN=t0ken\n");
		const prev = process.env.LISPTC_SECRETS_FILE;
		process.env.LISPTC_SECRETS_FILE = path;
		try {
			const repl = new AgentRepl();
			expect(await repl.eval("(secrets)")).not.toContain("REPL_PI_TOKEN");
		} finally {
			if (prev === undefined) delete process.env.LISPTC_SECRETS_FILE;
			else process.env.LISPTC_SECRETS_FILE = prev;
		}
	});

	it("lets a host inject secrets that survive reset()", async () => {
		const repl = new AgentRepl();
		repl.secrets.set({
			REPL_HOST_TOKEN: { value: "h0st", description: "from host" },
		});
		expect(await repl.eval('(secret "REPL_HOST_TOKEN")')).toContain(
			"#<secret:REPL_HOST_TOKEN>",
		);
		repl.reset();
		expect(await repl.eval('(secret "REPL_HOST_TOKEN")')).toContain(
			"#<secret:REPL_HOST_TOKEN>",
		);
		expect(await repl.eval("(secrets)")).toContain("from host");
	});

	it("uses a store handed in at construction", async () => {
		const store = new EnvSecretsStore();
		store.set({ REPL_SHARED_TOKEN: "shared" });
		const repl = new AgentRepl({ secretsStore: store });
		expect(await repl.eval('(secret "REPL_SHARED_TOKEN")')).toContain(
			"#<secret:REPL_SHARED_TOKEN>",
		);
	});
});
