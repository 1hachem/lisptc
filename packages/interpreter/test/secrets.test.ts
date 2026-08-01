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

describe("secret registry", () => {
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

	it("errors when reading an unknown secret", () => {
		expect(() => ev('(secret "REPL_NOPE")')).toThrow(/unknown secret/);
	});

	it("always prints a secret redacted, never its value", () => {
		const interp = freshInterp();
		interp.setSecrets({ REPL_FOO: "s3cr3t" });
		expect(ev('(secret "REPL_FOO")', interp)).toBe("#<secret:REPL_FOO>");
		expect(ev('(list "a" (secret "REPL_FOO") "b")', interp)).toBe(
			'("a" #<secret:REPL_FOO> "b")',
		);
	});

	it("is a string: length and stringp work", () => {
		const interp = freshInterp();
		interp.setSecrets({ REPL_FOO: "s3cr3t" });
		expect(ev('(length (secret "REPL_FOO"))', interp)).toBe("6");
		expect(ev('(stringp (secret "REPL_FOO"))', interp)).toBe("t");
	});
});

// Taint tracking: anything derived from a secret through a text function stays
// a secret and prints redacted — so an agent cannot transform its way around
// the redaction (upcase, reverse, substring, char, concat, ...).
describe("secret registry (taint propagation)", () => {
	function interpWith(value: string): Interp {
		const interp = freshInterp();
		interp.setSecrets({ REPL_FOO: value });
		return interp;
	}

	it("stays redacted through string-upcase / string-downcase", () => {
		const interp = interpWith("s3cr3t");
		expect(ev('(string-upcase (secret "REPL_FOO"))', interp)).toBe(
			"#<secret:REPL_FOO>",
		);
		expect(ev('(string-downcase (secret "REPL_FOO"))', interp)).toBe(
			"#<secret:REPL_FOO>",
		);
	});

	it("stays redacted through concat, char and substring", () => {
		const interp = interpWith("s3cr3t");
		expect(ev('(concat "Bearer " (secret "REPL_FOO"))', interp)).toBe(
			"#<secret:REPL_FOO>",
		);
		expect(ev('(char (secret "REPL_FOO") 0)', interp)).toBe(
			"#<secret:REPL_FOO>",
		);
		expect(ev('(substring (secret "REPL_FOO") 0 3)', interp)).toBe(
			"#<secret:REPL_FOO>",
		);
	});

	it("unions taint when two secrets are combined", () => {
		const interp = freshInterp();
		interp.setSecrets({ REPL_A: "aaa", REPL_B: "bbb" });
		expect(ev('(concat (secret "REPL_A") (secret "REPL_B"))', interp)).toBe(
			"#<secret:REPL_A+REPL_B>",
		);
	});

	it("still lets string predicates work on secrets (value compare)", () => {
		const interp = interpWith("s3cr3t");
		expect(ev('(string-prefix? "s3" (secret "REPL_FOO"))', interp)).toBe("t");
		expect(ev('(string-contains? (secret "REPL_FOO") "cr")', interp)).toBe("t");
	});

	it("plain strings are untainted (no false redaction)", () => {
		const interp = interpWith("s3cr3t");
		expect(ev('(concat "a" "b")', interp)).toBe('"ab"');
		expect(ev('(string-upcase "abc")', interp)).toBe('"ABC"');
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
			expect(str(run(interp, '(secret "REPL_FOO")'))).toBe(
				"#<secret:REPL_FOO>",
			);
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

describe("secret registry (revealed only into an MCP call)", () => {
	const interp = new Interp();
	run(interp, prelude);
	interp.setSecrets({ REPL_FOO: "s3cr3t" });

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("passes the real (and composed) value into an MCP tool call", () => {
		str(
			run(
				interp,
				`(await (load-mcp :name "fx" :command "node" :args (quote ("--experimental-transform-types" "${FIXTURE}"))))`,
			),
		);
		// The echo fixture returns its :message argument verbatim, proving the
		// real value is revealed on the way into the call.
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
