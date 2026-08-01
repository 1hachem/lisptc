import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Interp, prelude, run, setWriter, str } from "../src/lisp.ts";
import { AgentRepl } from "../src/repl.ts";
import { ev, freshInterp } from "./helpers.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

describe("secret registry", () => {
	it("lists the keys of registered secrets", () => {
		const interp = freshInterp();
		interp.setSecrets({ FOO: "bar", BAZ: "qux" });
		const out = ev("(secrets)", interp);
		expect(out).toContain("FOO");
		expect(out).toContain("BAZ");
	});

	it("returns an empty list when no secrets are registered", () => {
		expect(ev("(secrets)")).toBe("nil");
	});

	it("errors when reading an unknown secret", () => {
		expect(() => ev('(secret "NOPE")')).toThrow(/unknown secret/);
	});

	it("redacts a secret value when printed or returned", () => {
		const interp = freshInterp();
		interp.setSecrets({ FOO: "s3cr3t" });
		// Returned value is opaque.
		expect(ev('(secret "FOO")', interp)).toBe("#<secret:FOO>");
		// Printed value is opaque too, and never leaks the raw value.
		let output = "";
		const prev = setWriter((s: string) => {
			output += s;
		});
		try {
			run(interp, '(princ (secret "FOO"))');
		} finally {
			setWriter(prev);
		}
		expect(output).toBe("#<secret:FOO>");
		expect(output).not.toContain("s3cr3t");
	});

	it("does not leak the value even nested inside a printed list", () => {
		const interp = freshInterp();
		interp.setSecrets({ FOO: "s3cr3t" });
		const out = ev('(list "a" (secret "FOO") "b")', interp);
		expect(out).toBe('("a" #<secret:FOO> "b")');
		expect(out).not.toContain("s3cr3t");
	});
});

describe("secret registry (env seeding)", () => {
	it("seeds secrets from REPL_* env vars, overridable by setSecrets", () => {
		const prev = process.env.REPL_FOO;
		process.env.REPL_FOO = "from-env";
		try {
			const interp = new Interp();
			run(interp, prelude);
			expect(str(run(interp, "(secrets)"))).toContain("FOO");
			// The real value is revealed only on the way into a call; env-seeded
			// secrets print redacted like any other.
			expect(str(run(interp, '(secret "FOO")'))).toBe("#<secret:FOO>");
			// Programmatic setSecrets overrides the env-seeded value.
			interp.setSecrets({ FOO: "from-host" });
			expect(str(run(interp, '(secret "FOO")'))).toBe("#<secret:FOO>");
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

	it("loads KEY=VALUE entries from a .env file as secrets", () => {
		const path = writeEnvFile(
			'# a comment\nLINEAR_API_KEY=lin_abc123\nQUOTED="with spaces"\n',
		);
		const interp = freshInterp();
		interp.loadSecretsFromFile(path);
		const keys = ev("(secrets)", interp);
		expect(keys).toContain("LINEAR_API_KEY");
		expect(keys).toContain("QUOTED");
		// Values stay redacted.
		expect(ev('(secret "LINEAR_API_KEY")', interp)).toBe(
			"#<secret:LINEAR_API_KEY>",
		);
	});

	it("re-injects explicitly-loaded secrets on AgentRepl reset()", () => {
		const path = writeEnvFile("FOO=bar\n");
		const repl = new AgentRepl();
		// An embedder must opt in explicitly; AgentRepl does not auto-load .env.
		repl.loadSecretsFromFile(path);
		expect(repl.eval("(secrets)")).toContain("FOO");
		repl.reset();
		expect(repl.eval("(secrets)")).toContain("FOO");
	});

	it("does not auto-load $LISPTC_SECRETS_FILE for an embedded AgentRepl", () => {
		const path = writeEnvFile("PI_TOKEN=t0ken\n");
		const prev = process.env.LISPTC_SECRETS_FILE;
		process.env.LISPTC_SECRETS_FILE = path;
		try {
			// A plain AgentRepl (the pi embedding) must NOT pick the file up.
			const repl = new AgentRepl();
			expect(repl.eval("(secrets)")).not.toContain("PI_TOKEN");
		} finally {
			if (prev === undefined) delete process.env.LISPTC_SECRETS_FILE;
			else process.env.LISPTC_SECRETS_FILE = prev;
		}
	});
});

describe("secret registry (reveal at the MCP call boundary)", () => {
	const interp = new Interp();
	run(interp, prelude);
	interp.setSecrets({ FOO: "s3cr3t" });

	afterAll(() => {
		run(interp, "(mcp-shutdown)");
	});

	it("passes the real value into an MCP tool call while staying redacted in the REPL", () => {
		str(
			run(
				interp,
				`(await (load-mcp :name "fx" :command "node" :args (quote ("--experimental-transform-types" "${FIXTURE}"))))`,
			),
		);
		// The echo fixture returns its :message argument verbatim, proving the
		// secret was revealed on the way into the call.
		expect(str(run(interp, '(fx/echo :message (secret "FOO"))'))).toBe(
			'"s3cr3t"',
		);
		// But the secret itself still prints redacted.
		expect(str(run(interp, '(secret "FOO")'))).toBe("#<secret:FOO>");
	});
});
