import type { ChatSeed, Spawn, SubAgent } from "@repo/agents-extension/ports";
import { converse } from "@repo/ai";
import {
	type Connect,
	type RunnerFor,
	spawnChat,
} from "@repo/backend/agent-repl";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import type { ServerClient } from "@repo/backend/server-client";
import { chatTurns, notice } from "./chat-turns.ts";
import { delegated } from "./delegated.ts";
import { currentSession } from "./session.ts";

export function subAgents(connect: Connect, server: ServerClient): RunnerFor {
	return (_workspaceId, chatId) => {
		async function forkChat(child: Id<"chats">, chat: ChatSeed) {
			if (chat.from === "fresh") return;
			const earlier = await connect().query(api.messages.transcript, {
				chatId,
			});
			if (earlier.length === 0) return;
			await connect().mutation(api.messages.append, {
				chatId: child,
				messages: earlier.map(({ wireId, type, content, kwargs }) => ({
					...(wireId === undefined ? {} : { id: wireId }),
					type,
					content,
					...(kwargs === undefined ? {} : { kwargs }),
				})),
			});
		}

		function subAgent({ definition, seed, chat }: Spawn): SubAgent {
			const open = async () => {
				const child = await spawnChat(connect, server, {
					parent: chatId,
					definition,
					seed,
				});
				await forkChat(child, chat);
				return child;
			};
			let opening: Promise<Id<"chats">> | undefined;
			return {
				async send({ message, maxSteps, signal }) {
					const session = currentSession();
					opening ??= open();
					const child = await opening;
					return converse(
						(said) =>
							chatTurns().reply(session, child, said, { maxSteps, signal }),
						message,
						async (held) => {
							const id = crypto.randomUUID();
							const answered = delegated.wait(
								id,
								chatTurns().source(child),
								signal,
							);
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
			runner: { spawn: subAgent },
			notify: (reply) => {
				try {
					notice({ session: currentSession(), chatId, notice: reply });
				} catch (error) {
					console.error(`chat=${chatId} has no session to wake with:`, error);
				}
			},
		};
	};
}
