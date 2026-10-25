import { describe, expect, it } from "vitest";
import { agentSource } from "../convex/lib/agentSource.ts";
import { parseAgentSource, SourceAgentStore } from "../src/agent-store.ts";
import { ConvexSourceFolder, type SourceClient } from "../src/source-folder.ts";
import { harness, signIn } from "./helpers.ts";

describe("agent definitions as sources", () => {
	it("reads back the defagent text it writes", () => {
		const bounded = {
			name: "r",
			prompt: 'say "hi"\nthen dig',
			permissions: "(permission/deny fs/*)",
		};
		expect(agentSource({ name: "r", prompt: "dig" })).toBe(
			'(defagent "r"\n  :prompt "dig")',
		);
		expect(parseAgentSource(agentSource(bounded))).toEqual(bounded);
		expect(parseAgentSource("not a form")).toBeUndefined();
	});

	it("stores each definition as sub-agents/<name>.ptc in its workspace", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const folder = new ConvexSourceFolder(
			() => alice.as as unknown as SourceClient,
		);
		const store = new SourceAgentStore(folder, alice.workspace);
		await store.put({ name: "researcher", prompt: "dig" });
		expect(await folder.list(alice.workspace, "sub-agents")).toEqual([
			"researcher.ptc",
		]);
		expect(await store.all()).toEqual([{ name: "researcher", prompt: "dig" }]);
		expect(await store.delete("researcher")).toBe(true);
		expect(await store.all()).toEqual([]);
	});

	it("shows only the roster it was handed", async () => {
		const t = harness();
		const alice = await signIn(t, "alice@example.com");
		const folder = new ConvexSourceFolder(
			() => alice.as as unknown as SourceClient,
		);
		await new SourceAgentStore(folder, alice.workspace).put({
			name: "hidden",
			prompt: "x",
		});
		const store = new SourceAgentStore(folder, alice.workspace, ["shown"]);
		expect(await store.all()).toEqual([]);
		expect(await store.get("hidden")).toBeUndefined();
	});
});
