import { journal } from "@repo/interpreter/journal";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import type { InterpExtension } from "@repo/interpreter/session";
import type { Entry } from "@repo/shared/journal";
import { describe, expect, it } from "vitest";
import { agentRepl } from "./helpers.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function progressing(): InterpExtension {
	return (interp: Interp): void => {
		interp.defineGlobal(
			newSym("progress"),
			interp.makeBuiltIn("progress", 1, (n: unknown) => {
				journal.emit(interp.channels, {
					harness: { kind: "progress", value: Number(n) },
				});
				return 0;
			}),
		);
		interp.defineGlobal(
			newSym("later"),
			interp.makeBuiltIn("later", 1, (n: unknown) => {
				setTimeout(() =>
					journal.emit(interp.channels, {
						harness: { kind: "progress", value: Number(n) },
					}),
				);
				return 0;
			}),
		);
		interp.defineGlobal(
			newSym("pause"),
			interp.makeBuiltIn("pause", 1, (ms: unknown) =>
				sleep(Number(ms)).then(() => 0),
			),
		);
	};
}

describe("entries while a step runs", () => {
	it("reach the caller the moment each is recorded, in order", async () => {
		const seen: { entry: Entry; at: number }[] = [];
		const started = Date.now();
		const out = await agentRepl([progressing()]).evalOutput(
			"(progress 1) (pause 200) (progress 2) (pause 200) (progress 3)",
			undefined,
			(entry) => seen.push({ entry, at: Date.now() - started }),
		);

		expect(seen.map((s) => s.entry.value)).toEqual([1, 2, 3]);
		expect(seen[1].at - seen[0].at).toBeGreaterThanOrEqual(150);
		expect(seen[2].at - seen[1].at).toBeGreaterThanOrEqual(150);
		expect(out.entries).toEqual(seen.map((s) => s.entry));
	});

	it("are the same entries the step ends with when nobody watches", async () => {
		const code = "(progress 1) (progress 1) (progress 2)";
		const quiet = await agentRepl([progressing()]).evalOutput(code);

		expect(quiet.entries).toEqual([
			{ kind: "progress", value: 1 },
			{ kind: "progress", value: 1 },
			{ kind: "progress", value: 2 },
		]);
	});

	it("hand over what was recorded between steps first, live, and only once", async () => {
		const repl = agentRepl([progressing()]);
		await repl.evalOutput("(later 0)");
		await sleep(10);
		const seen: Entry[] = [];
		const out = await repl.evalOutput("(progress 1)", undefined, (entry) =>
			seen.push(entry),
		);

		expect(seen.map((e) => e.value)).toEqual([0, 1]);
		expect(out.entries).toEqual(seen);
	});

	it("stop reaching the caller once the step is over", async () => {
		const seen: Entry[] = [];
		const repl = agentRepl([progressing()]);
		await repl.evalOutput("(progress 1)", undefined, (entry) =>
			seen.push(entry),
		);
		await repl.evalOutput("(progress 2)");

		expect(seen.map((e) => e.value)).toEqual([1]);
	});
});
