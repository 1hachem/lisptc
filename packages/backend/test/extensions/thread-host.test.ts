import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel.js";
import { MAX_SPAWN_DEPTH } from "../../convex/limits.ts";
import type { Connect } from "../../src/agent-repl.ts";
import type { Owner, ServerClient } from "../../src/server-client.ts";
import { profileOf, ThreadHost } from "../../src/thread-host.ts";

const WORKSPACE = "workspace-1" as Id<"workspaces">;
const CHAT = "chat-1" as Id<"chats">;
const OWNER = "user-1" as Id<"users">;

type Agent = {
	name: string;
	prompt: string;
	bounds: string[];
	roster?: string[];
	budget?: number;
};

const named = (reference: unknown) =>
	getFunctionName(reference as FunctionReference<"query" | "mutation">);

function serverOver(lineage: { agent?: Agent }[]): ServerClient {
	const answer = (reference: unknown): Promise<unknown> => {
		const name = named(reference);
		if (name === "threads:record")
			return Promise.resolve({
				workspaceId: WORKSPACE,
				ownerId: OWNER,
				title: "child",
				runsForms: true,
				lineage,
			});
		if (name === "threads:repl") return Promise.resolve("repl-1");
		return Promise.resolve(null);
	};
	return {
		query: answer,
		mutation: answer,
	} as unknown as ServerClient;
}

const workspaceAgents = ["scout", "digger", "writer"];

const offline: Connect = () =>
	({
		query: (reference: unknown, args: { name?: string }) => {
			const name = named(reference);
			if (name === "sources:list")
				return Promise.resolve(workspaceAgents.map((agent) => `${agent}.ptc`));
			if (name === "sources:get") {
				const agent = args.name?.replace(/\.ptc$/, "") ?? "";
				return Promise.resolve(
					workspaceAgents.includes(agent)
						? `(defagent "${agent}"\n  :prompt "be ${agent}")`
						: null,
				);
			}
			return Promise.resolve(name.endsWith(":list") ? [] : null);
		},
		mutation: () => Promise.resolve(null),
	}) as unknown as ReturnType<Connect>;

const root = {};
const middle: { agent: Agent } = {
	agent: {
		name: "lead",
		prompt: "lead the dig",
		bounds: ["(permission/deny memory/*)"],
		roster: ["scout", "digger"],
		budget: 12,
	},
};
const child: { agent: Agent } = {
	agent: {
		name: "digger",
		prompt: "dig only",
		bounds: ["(permission/deny knowledge/*)"],
		roster: ["digger", "writer"],
		budget: 30,
	},
};

describe("the thread factory", () => {
	it("narrows bounds and budget down the lineage and leaves a sub-agent no roster", () => {
		expect(profileOf([child, middle])).toEqual({
			instructions: "dig only",
			bounds: ["(permission/deny knowledge/*)", "(permission/deny memory/*)"],
			roster: [],
			budget: 12,
		});
	});

	it("leaves a root chat the whole workspace", () => {
		expect(profileOf([root])).toEqual({ bounds: [] });
	});

	it("gives a thread at the depth cap no agents to spawn", () => {
		const lineage = [
			...Array.from({ length: MAX_SPAWN_DEPTH }, () => middle),
			root,
		];
		expect(profileOf(lineage).roster).toEqual([]);
	});

	it("sets up the turn with the record's instructions", async () => {
		const host = new ThreadHost({
			server: serverOver([child, middle, root]),
			actAs: () => offline(),
		});
		const setup = await host.setup(CHAT);
		expect(setup.config?.instructions).toBe("dig only");
		expect(setup.runsForms).toBe(true);
	});

	it("seeds a thread's budget with its own agent's", async () => {
		const host = new ThreadHost({
			server: serverOver([child, middle, root]),
			actAs: () => offline(),
		});
		expect(await host.lineage(CHAT)).toEqual({
			title: "child",
			limits: { steps: 30 },
		});
	});

	it("builds a repl bound by every ancestor and shown no agents to spawn", async () => {
		const host = new ThreadHost({
			server: serverOver([child, middle]),
			actAs: () => offline(),
		});
		const repl = await host.repl(CHAT);
		const ev = async (code: string) =>
			(await repl.evalOutput(code)).results.at(-1);
		expect(await ev("(permission/check 'memory/forget-all)")).toBe("deny");
		expect(await ev("(permission/check 'knowledge/write)")).toBe("deny");
		expect(await ev("(agents)")).toBe("nil");
	});

	it("runs its stores as the record's owner with no request behind it", async () => {
		const actedFor: Owner[] = [];
		const asked: string[] = [];
		const host = new ThreadHost({
			server: serverOver([root]),
			actAs: (owner) => {
				actedFor.push(owner);
				const client = offline();
				return {
					...client,
					query: ((reference: unknown, args: unknown) => {
						asked.push(named(reference));
						return client.query(reference as never, args as never);
					}) as typeof client.query,
				};
			},
		});
		const repl = await host.repl(CHAT);
		expect((await repl.evalOutput("(agents)")).results.at(-1)).toContain(
			"scout",
		);
		expect(actedFor).toEqual([{ userId: OWNER, workspaceId: WORKSPACE }]);
		expect(asked).toContain("sources:list");
	});
});
