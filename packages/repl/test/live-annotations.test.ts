import { topic } from "@repo/interpreter/channels";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import {
	type Annotations,
	annotating,
	type InterpExtension,
	type SessionHooks,
} from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { agentRepl } from "./helpers.ts";

const progressed = topic<number>("progressed");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function progressing(): InterpExtension {
	return Object.assign(
		(interp: Interp): void => {
			interp.defineGlobal(
				newSym("progress"),
				interp.makeBuiltIn("progress", 1, (n: unknown) => {
					progressed.emit(interp.channels, { user: Number(n) });
					return 0;
				}),
			);
			interp.defineGlobal(
				newSym("pause"),
				interp.makeBuiltIn("pause", 1, (ms: unknown) =>
					sleep(Number(ms)).then(() => 0),
				),
			);
		},
		{
			session(hooks: SessionHooks): void {
				hooks.annotate.use((buffer, into, next) => {
					const last = buffer.collect(progressed).at(-1);
					return next(
						buffer,
						last === undefined
							? into
							: annotating(into, "output", { progress: last }),
					);
				});
			},
		},
	);
}

describe("annotations while a step runs", () => {
	it("reach the caller as the step goes, and the step ends the same", async () => {
		const pushed: Annotations[] = [];
		const code =
			"(progress 1) (pause 250) (progress 2) (pause 250) (progress 3) (pause 250)";

		const live = await agentRepl([progressing()]).evalOutput(
			code,
			undefined,
			(output) => pushed.push(output),
		);
		const quiet = await agentRepl([progressing()]).evalOutput(code);

		expect(pushed).toEqual([{ progress: 1 }, { progress: 2 }, { progress: 3 }]);
		expect(live.annotations).toEqual(quiet.annotations);
		expect(live.annotations.output).toEqual({ progress: 3 });
	});

	it("push nothing that did not change", async () => {
		const pushed: Annotations[] = [];
		await agentRepl([progressing()]).evalOutput(
			"(progress 1) (pause 250) (progress 1) (pause 250)",
			undefined,
			(output) => pushed.push(output),
		);

		expect(pushed).toEqual([{ progress: 1 }]);
	});

	it("stop with the step, whose result supersedes them", async () => {
		const pushed: Annotations[] = [];
		await agentRepl([progressing()]).evalOutput(
			"(progress 1) (progress 2)",
			undefined,
			(output) => pushed.push(output),
		);
		await sleep(250);

		expect(pushed).toEqual([]);
	});
});
