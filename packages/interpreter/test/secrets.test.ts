import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Interp, prelude, run, str } from "../src/lisp.ts";
import { AgentRepl } from "../src/repl.ts";
import { ev, freshInterp } from "./helpers.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

// Interpreter-level behaviour: secrets are ordinary strings; redaction is a
// REPL concern (see the AgentRepl block below), so `ev` sees raw values.
describe("secret registry (interpreter level)", () => {
	it("lists the keys of registered secrets (prefix kept)", () => {
		const interp = freshInterp();
		interp.setSecrets({ REPL_FOO: "bar", REPL_BAZ: "qux" });
		const out = ev("(secrets)", interp);
		expect(out).toContain("REPL_FOO");
		expect(out).toContain("REPL_BAZ");
	});

	it("only registers keys starting with REPL_", () => {
		const interp = freshInterp();
		interp.setSecrets({ REPL_FOO: "bar", NOT_A_SECRET: "nope" });
		const out = ev("(secrets)", interp);
		expect(out).toContain("REPL_FOO");
		expect(out).not.toContain("NOT_A_SECRET");
		expect(() => ev('(secret "NOT_A_SECRET")', interp)).toThrow(
			/unknown secret/,
		);
	});

	it("returns an empty list when no secrets are registered", () => {
		expect(ev("(secrets)")).toBe("nil");
	});

	it("errors when reading an unknown secret", () => {
		expect(() => ev('(secret "REPL_NOPE")')).toThrow(/unknown secret/);
	});

	it("is an ordinary string usable by any text function", () => {
		const interp = freshInterp();
		interp.setSecrets({ REPL_FOO: "s3cr3t" });
		// A raw secret is just its value at the interpreter level.
		expect(ev('(secret "REPL_FOO")', interp)).toBe('"s3cr3t"');
		// Every string function works — concat, upcase, length, ...
		expect(ev('(concat "Bearer " (secret "REPL_FOO"))', interp)).toBe(
			'"Bearer s3cr3t"',
		);
		expect(ev('(string-upcase (secret "REPL_FOO"))', interp)).toBe('"S3CR3T"');
		expect(ev('(length (secret "REPL_FOO"))', interp)).toBe("6");
	});
});

// The REPL redacts secret values out of everything it prints — returned
// values and prin1/princ side-effect output alike.
describe("secret registry (REPL redaction)", () => {
	function replWithSecret(value: string): AgentRepl {
		const repl = new AgentRepl();
		repl.setSecrets({ REPL_FOO: value });
		return repl;
	}

	it("redacts a returned secret value", () => {
		const repl = replWithSecret("s3cr3t");
		expect(repl.eval('(secret "REPL_FOO")').trim()).toBe(
			'"#<secret:REPL_FOO>"',
		);
	});

	it("redacts side-effect (princ) output", () => {
		const repl = replWithSecret("s3cr3t");
		const out = repl.eval('(princ (secret "REPL_FOO"))');
		expect(out).not.toContain("s3cr3t");
		expect(out).toContain("#<secret:REPL_FOO>");
	});

	it("redacts a secret nested inside a composed string", () => {
		const repl = replWithSecret("s3cr3t");
		const out = repl.eval('(concat "Bearer " (secret "REPL_FOO"))').trim();
		// The `Bearer ` text stays; only the secret value is masked.
		expect(out).toBe('"Bearer #<secret:REPL_FOO>"');
		expect(out).not.toContain("s3cr3t");
	});

	it("does not redact when nothing matches a secret value", () => {
		const repl = replWithSecret("s3cr3t");
		expect(repl.eval('(concat "a" "b")').trim()).toBe('"ab"');
	});
});

describe("secret registry (env seeding)", () => {
	it("seeds secrets from REPL_* env vars, keeping the prefix", () => {
		const prev = process.env.REPL_FOO;
		process.env.REPL_FOO = "from-env";
		try {
			const interp = new Interp();
			run(interp, prelude);
			expect(str(run(interp, "(secrets)"))).toContain("REPL_FOO");
			interp.setSecrets({ REPL_FOO: "from-host" });
			expect(str(run(interp, '(secret "REPL_FOO")'))).toBe('"from-host"');
		} finally {
			if (prev === undefined) delete process.env.REPL_FOO;
			else process.env.REPL_FOO = prev;
		}
	});
});

describe("secret registry (.env file loading)", () => {
	function writeEnvFile(contents: string): string {
		const dir = mkdtempSync(join(tmpdir(), "lisptc-secrets-"));
		const path = join(dir, ".env");
		writeFileSync(path, contents);
		return path;
	}

	it("loads only REPL_-prefixed entries, keeping the prefix", () => {
		const path = writeEnvFile(
			"# a comment\nREPL_LINEAR_API_KEY=lin_abc123\nNOT_A_SECRET=nope\n",
		);
		const interp = freshInterp();
		interp.loadSecretsFromFile(path);
		const keys = ev("(secrets)", interp);
		expect(keys).toContain("REPL_LINEAR_API_KEY");
		expect(keys).not.toContain("NOT_A_SECRET");
	});

	it("re-injects explicitly-loaded secrets on AgentRepl reset()", () => {
		const path = writeEnvFile("REPL_FOO=bar\n");
		const repl = new AgentRepl();
		repl.loadSecretsFromFile(path);
		expect(repl.eval("(secrets)")).toContain("REPL_FOO");
		repl.reset();
		expect(repl.eval("(secrets)")).toContain("REPL_FOO");
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

describe("secret registry (used in an MCP call)", () => {
	const interp = new Interp();
	run(interp, prelude);
	interp.setSecrets({ REPL_FOO: "s3cr3t" });

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("passes the real value (and composed values) into an MCP tool call", () => {
		str(
			run(
				interp,
				`(await (load-mcp :name "fx" :command "node" :args (quote ("--experimental-transform-types" "${FIXTURE}"))))`,
			),
		);
		// The echo fixture returns its :message argument verbatim, proving the
		// real value (no redaction) reaches the tool.
		expect(str(run(interp, '(fx/echo :message (secret "REPL_FOO"))'))).toBe(
			'"s3cr3t"',
		);
		expect(
			str(
				run(
					interp,
					'(fx/echo :message (concat "Bearer " (secret "REPL_FOO")))',
				),
			),
		).toBe('"Bearer s3cr3t"');
	});
});
