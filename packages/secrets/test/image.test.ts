import { restore, snapshot } from "@repo/interpreter/image";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { describe, expect, it } from "vitest";
import type { SecretsStore } from "../src/ports.ts";
import { secretsExtension } from "../src/secrets.ts";
import { envSecretsStore, secretsHost } from "../src/secrets-host.ts";

function storeWith(value: string): SecretsStore {
	const store = envSecretsStore({ env: {} });
	store.set({ REPL_TOKEN: { value, description: "a token" } });
	return store;
}

function interpOver(store: SecretsStore): Interp {
	return new Interp({
		extensions: [secretsExtension({ ...secretsHost, store })],
	});
}

function imaged(code: string): { json: string; back: Interp } {
	const interp = interpOver(storeWith("tok-123"));
	runSync(interp, prelude);
	runSync(interp, code);
	const json = JSON.stringify(snapshot(interp));
	const back = interpOver(storeWith("tok-123"));
	restore(back, JSON.parse(json));
	return { json, back };
}

describe("a secret in an image", () => {
	it("is written as its key and never as its value", () => {
		const { json } = imaged(
			'(setq raw (secret "REPL_TOKEN") bearer (concat "Bearer " raw))',
		);
		expect(json).not.toContain("tok-123");
		expect(json).toContain("REPL_TOKEN");
	});

	it("comes back from the store when it was taken whole", () => {
		const { back } = imaged('(setq raw (secret "REPL_TOKEN"))');
		expect(str(runSync(back, "raw"))).toBe("#<secret:REPL_TOKEN>");
		expect(str(runSync(back, "(length raw)"))).toBe("7");
	});

	it("comes back lost when it was derived, and says how to get it again", () => {
		const { back } = imaged(
			'(setq bearer (concat "Bearer " (secret "REPL_TOKEN")))',
		);
		expect(str(runSync(back, "bearer"))).toBe("#<secret:REPL_TOKEN>");
		expect(() => runSync(back, "(length bearer)")).toThrow(
			"secret lost by a restore",
		);
	});
});
