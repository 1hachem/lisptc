import type {
	AgentRunner,
	ChatSeed,
	Spawn,
	SubAgent,
} from "@repo/agents-extension/ports";
import { Conversation, converse, toTranscript } from "@repo/ai";
import {
	type Connect,
	type RunnerFor,
	seededRepl,
} from "@repo/backend/agent-repl";
import { api } from "@repo/backend/api";
import { TURN_DEADLINE_MS } from "@repo/backend/limits";
import { delegated } from "./delegated.ts";
import { toInput } from "./history.ts";
import { chatModel } from "./model.ts";
import { notice } from "./notices.ts";
import { currentSession } from "./session.ts";

const MAX_SPAWN_DEPTH = 2;

export function subAgents(connect: Connect): RunnerFor {
	return (workspaceId, chatId) => {
		const session = currentSession();
		const config = async () =>
			chatModel(
				(await connect().query(api.workspaces.get, { workspaceId })).model,
			);

		async function history(chat: ChatSeed) {
			if (chat.from === "fresh") return [];
			const stored = await connect().query(api.messages.transcript, {
				chatId,
			});
			return toTranscript({ messages: toInput(stored) });
		}

		function runner(depth: number, bounds: readonly string[]): AgentRunner {
			return { spawn: (spawn) => subAgent(spawn, depth, bounds) };
		}

		function subAgent(
			{ definition, seed, chat }: Spawn,
			depth: number,
			bounds: readonly string[],
		): SubAgent {
			const bounded =
				definition.permissions === undefined
					? bounds
					: [...bounds, definition.permissions];
			const open = () =>
				Promise.all([
					seededRepl(workspaceId, connect, {
						seed,
						bounds: bounded,
						...(depth < MAX_SPAWN_DEPTH
							? { runner: runner(depth + 1, bounded) }
							: {}),
					}),
					history(chat),
				]).then(([repl, earlier]) => ({
					repl,
					conversation: new Conversation(
						repl,
						definition.prompt,
						config,
						earlier,
					),
				}));
			let opening: ReturnType<typeof open> | undefined;
			return {
				async send({ message, maxSteps, signal }) {
					opening ??= open();
					const { repl, conversation } = await opening;
					return converse(
						conversation,
						message,
						() => ({
							maxSteps,
							signal: AbortSignal.any([
								signal,
								AbortSignal.timeout(TURN_DEADLINE_MS),
							]),
						}),
						async (held) => {
							const id = crypto.randomUUID();
							const answered = delegated.wait(id, repl, signal);
							await connect().mutation(api.messages.append, {
								chatId,
								messages: [
									{
										id,
										type: "tool",
										content: `agent ${definition.name} is waiting on you`,
										kwargs: held.output,
									},
								],
							});
							return answered;
						},
					);
				},
			};
		}

		return {
			runner: runner(0, []),
			notify: (reply) => notice({ session, chatId, notice: reply }),
		};
	};
}
