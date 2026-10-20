import type {
	AgentRunner,
	Spawn,
	SubAgent,
} from "@repo/agents-extension/ports";
import { Conversation } from "@repo/ai";
import {
	type Connect,
	type RunnerFor,
	seededRepl,
} from "@repo/backend/agent-repl";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { TURN_DEADLINE_MS } from "@repo/backend/limits";
import { chatModel } from "./model.ts";

const MAX_SPAWN_DEPTH = 2;

export function subAgents(connect: Connect): RunnerFor {
	function runner(workspaceId: Id<"workspaces">, depth: number): AgentRunner {
		const nested =
			depth < MAX_SPAWN_DEPTH ? runner(workspaceId, depth + 1) : undefined;
		return { spawn: (spawn) => subAgent(workspaceId, spawn, nested) };
	}

	function subAgent(
		workspaceId: Id<"workspaces">,
		{ definition, seed }: Spawn,
		nested: AgentRunner | undefined,
	): SubAgent {
		const config = async () =>
			chatModel(
				(await connect().query(api.workspaces.get, { workspaceId })).model,
			);
		let opening: Promise<Conversation> | undefined;
		return {
			async send({ message, maxSteps, signal }) {
				opening ??= seededRepl(workspaceId, connect, seed, nested).then(
					(repl) => new Conversation(repl, definition.prompt, config),
				);
				return (await opening).reply(message, {
					maxSteps,
					signal: AbortSignal.any([
						signal,
						AbortSignal.timeout(TURN_DEADLINE_MS),
					]),
				});
			},
		};
	}

	return (workspaceId) => runner(workspaceId, 0);
}
