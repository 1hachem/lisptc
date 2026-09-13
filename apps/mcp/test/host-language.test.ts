import { agentExtensions } from "@repo/ai/repl-store";
import type { InterpExtension } from "@repo/interpreter/lisp";
import { Interp, prelude, runSync } from "@repo/interpreter/lisp";
import { sessionExtensions } from "@repo/repl/session-server";
import { describe, expect, it } from "vitest";
import { replExtensions } from "../src/repl.ts";

function globalNames(extensions: InterpExtension[]): string[] {
	const interp = new Interp({ extensions });
	runSync(interp, prelude);
	return interp.globalNames().sort();
}

describe("the agent-facing hosts", () => {
	it("speak the same language", () => {
		const agent = globalNames(agentExtensions());

		expect(globalNames(sessionExtensions())).toEqual(agent);
		expect(globalNames(replExtensions())).toEqual(agent);
	});
});
