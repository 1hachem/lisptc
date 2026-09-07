import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Interp, prelude, runAsync, runSync, str } from "../src/lisp.ts";
import { mcpExtension } from "../src/mcp.ts";
import {
	EnvSecretsStore,
	loadSecretsFromFile,
	type SecretSpec,
	secretsExtension,
} from "../src/secrets.ts";
import { ev } from "./helpers.ts";

const FIXTURE = fileURLToPath(
	new URL("./fixture-mcp-server.ts", import.meta.url),
);

function interpWithSecrets(record: Record<string, SecretSpec>): Interp {
	const store = new EnvSecretsStore();
	store.set(record);
	const interp = new Interp({ extensions: [secretsExtension({ store })] });
	runSync(interp, prelude);
	return interp;
}

describe("secret registry", () => {
	it("lists (key . description) pairs for each secret", async () => {
		const interp = interpWithSecrets({
			REPL_API_KEY: { value: "lin_abc", description: "Linear API key" },
			REPL_DB_PASS: "hunter2",
		});
		expect(ev("(secrets)", interp)).toBe(
			'(("REPL_API_KEY" . "Linear API key") ("REPL_DB_PASS" . ""))',
		);
	});

	it("reads a description out of the alist with assoc", async () => {
		const interp = interpWithSecrets({
			REPL_API_KEY: { value: "lin_abc", description: "Linear API key" },
		});
		expect(ev('(cdr (assoc "REPL_API_KEY" (secrets)))', interp)).toBe(
			'"Linear API key"',
		);
	});

	it("only registers keys starting with REPL_", async () => {
		const interp = interpWithSecrets({ REPL_FOO: "bar", NOT_A_SECRET: "nope" });
		const out = ev("(secrets)", interp);
		expect(out).toContain("REPL_FOO");
		expect(out).not.toContain("NOT_A_SECRET");
		expect(() => ev('(secret "NOT_A_SECRET")', interp)).toThrow(
			/unknown secret/,
		);
	});

	it("errors when reading an unknown secret", async () => {
		expect(() => ev('(secret "REPL_NOPE")')).toThrow(/unknown secret/);
	});

	it("always prints a secret redacted, never its value", async () => {
		const interp = interpWithSecrets({ REPL_FOO: "s3cr3t" });
		expect(ev('(secret "REPL_FOO")', interp)).toBe("#<secret:REPL_FOO>");
		expect(ev('(list "a" (secret "REPL_FOO") "b")', interp)).toBe(
			'("a" #<secret:REPL_FOO> "b")',
		);
	});

	it("is a string: length and stringp work", async () => {
		const interp = interpWithSecrets({ REPL_FOO: "s3cr3t" });
		expect(ev('(length (secret "REPL_FOO"))', interp)).toBe("6");
		expect(ev('(stringp (secret "REPL_FOO"))', interp)).toBe("t");
	});
});

describe("secret registry (taint propagation)", () => {
	function interpWith(value: string): Interp {
		return interpWithSecrets({ REPL_FOO: value });
	}

	it("stays redacted through string-upcase / string-downcase", async () => {
		const interp = interpWith("s3cr3t");
		expect(ev('(string-upcase (secret "REPL_FOO"))', interp)).toBe(
			"#<secret:REPL_FOO>",
		);
		expect(ev('(string-downcase (secret "REPL_FOO"))', interp)).toBe(
			"#<secret:REPL_FOO>",
		);
	});

	it("stays redacted through concat, char and substring", async () => {
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

	it("converts a secret to itself, so string cannot launder the taint", async () => {
		const interp = interpWith("s3cr3t");
		expect(ev('(string (secret "REPL_FOO"))', interp)).toBe(
			"#<secret:REPL_FOO>",
		);
		expect(ev('(concat "Bearer " (string (secret "REPL_FOO")))', interp)).toBe(
			"#<secret:REPL_FOO>",
		);
		expect(ev("(string 12)", interp)).toBe('"12"');
	});

	it("unions taint when two secrets are combined", async () => {
		const interp = interpWithSecrets({ REPL_A: "aaa", REPL_B: "bbb" });
		expect(ev('(concat (secret "REPL_A") (secret "REPL_B"))', interp)).toBe(
			"#<secret:REPL_A+REPL_B>",
		);
	});

	it("still lets string predicates work on secrets (value compare)", async () => {
		const interp = interpWith("s3cr3t");
		expect(ev('(string-prefix? "s3" (secret "REPL_FOO"))', interp)).toBe("t");
		expect(ev('(string-contains? (secret "REPL_FOO") "cr")', interp)).toBe("t");
	});

	it("plain strings are untainted (no false redaction)", async () => {
		const interp = interpWith("s3cr3t");
		expect(ev('(concat "a" "b")', interp)).toBe('"ab"');
		expect(ev('(string-upcase "abc")', interp)).toBe('"ABC"');
	});
});

describe("secret registry (env seeding)", () => {
	it("seeds secrets from REPL_* env vars, keeping the prefix (no description)", async () => {
		const prev = process.env.REPL_FOO;
		process.env.REPL_FOO = "from-env";
		try {
			const interp = new Interp({ extensions: [secretsExtension()] });
			runSync(interp, prelude);
			expect(str(await runAsync(interp, "(secrets)"))).toBe(
				'(("REPL_FOO" . ""))',
			);
			expect(str(await runAsync(interp, '(secret "REPL_FOO")'))).toBe(
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

	it("loads only REPL_-prefixed entries, keeping the prefix", async () => {
		const path = writeEnvFile(
			"# a comment\nREPL_LINEAR_API_KEY=lin_abc123\nNOT_A_SECRET=nope\n",
		);
		const store = new EnvSecretsStore();
		loadSecretsFromFile(store, path);
		const interp = new Interp({ extensions: [secretsExtension({ store })] });
		runSync(interp, prelude);
		const keys = ev("(secrets)", interp);
		expect(keys).toContain("REPL_LINEAR_API_KEY");
		expect(keys).not.toContain("NOT_A_SECRET");
	});
});

describe("secret registry (revealed only into an MCP call)", () => {
	const store = new EnvSecretsStore();
	store.set({ REPL_FOO: "s3cr3t" });
	const interp = new Interp({
		extensions: [secretsExtension({ store }), mcpExtension()],
	});
	runSync(interp, prelude);

	afterAll(async () => {
		await runAsync(interp, "(mcp-shutdown)");
	});

	it("passes the real (and composed) value into an MCP tool call", async () => {
		await runAsync(
			interp,
			`(await (load-mcp :name "fx" :command "node" :args (quote ("--no-warnings" "--experimental-transform-types" "${FIXTURE}"))))`,
		);
		expect(
			str(await runAsync(interp, '(fx/echo :message (secret "REPL_FOO"))')),
		).toBe('"s3cr3t"');
		expect(
			str(
				await runAsync(
					interp,
					'(fx/echo :message (concat "Bearer " (secret "REPL_FOO")))',
				),
			),
		).toBe('"Bearer s3cr3t"');
	});
});

describe("core interpreter (no secrets extension)", () => {
	function coreInterp(): Interp {
		const interp = new Interp({});
		runSync(interp, prelude);
		return interp;
	}

	it("has no (secret) built-in", async () => {
		expect(() => ev('(secret "REPL_FOO")', coreInterp())).toThrow(
			/undefined: secret/,
		);
	});

	it("string primitives work on plain strings", async () => {
		const interp = coreInterp();
		expect(ev('(concat "a" "b")', interp)).toBe('"ab"');
		expect(ev('(length "abc")', interp)).toBe("3");
		expect(ev('(stringp "abc")', interp)).toBe("t");
		expect(ev('(eql "a" "a")', interp)).toBe("t");
	});
});
