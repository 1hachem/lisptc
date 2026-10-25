import type {
	AgentRunner,
	ChatSeed,
	CodeRunner,
} from "@repo/agents-extension/ports";
import { converse, type ReplSource } from "@repo/ai";
import {
	type Connect,
	forkedRepl,
	type RunnerFor,
	spawnChat,
} from "@repo/backend/agent-repl";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import type { ServerClient } from "@repo/backend/server-client";
import type { StepAnnotations } from "@repo/interpreter/session";
import { chatTurns, notice } from "./chat-turns.ts";
import { delegated } from "./delegated.ts";
import { currentSession } from "./session.ts";
import { relay } from "./threads.ts";

export function subAgents(connect: Connect, server: ServerClient): RunnerFor {
	return (workspaceId, chatId) => {
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

		async function surface<Id extends string>(
			who: string,
			held: StepAnnotations,
			source: ReplSource<Id>,
			signal: AbortSignal,
		): Promise<string> {
			const id = crypto.randomUUID();
			const answered = delegated.wait(id, source, signal);
			const content = `${who} is waiting on you`;
			await connect().mutation(api.messages.append, {
				chatId,
				messages: [{ id, type: "tool", content, kwargs: held.output }],
			});
			relay(chatId, {
				id,
				type: "tool",
				content,
				additional_kwargs: held.output,
			});
			return answered;
		}

		const agents: AgentRunner = {
			async spawn({ definition, seed, chat }) {
				const child = await spawnChat(connect, server, {
					parent: chatId,
					definition,
					seed,
				});
				await forkChat(child, chat);
				return child;
			},
			async send(agent, { message, maxSteps, signal }) {
				const session = currentSession();
				const child = agent as Id<"chats">;
				const { title } = await connect().query(api.chats.get, {
					chatId: child,
				});
				return converse(
					(said) =>
						chatTurns().reply(session, child, said, { maxSteps, signal }),
					message,
					(held) =>
						surface(`agent ${title}`, held, chatTurns().source(child), signal),
				);
			},
		};

		const code: CodeRunner = {
			async run({ source, image }, signal) {
				const { agent } = await connect().query(api.chats.get, { chatId });
				const repl = await forkedRepl(workspaceId, connect, {
					image,
					bounds: agent?.bounds ?? [],
				});
				const ran = await repl.evalOutput(source);
				if (ran.held)
					return await surface(
						"background code",
						ran.annotations,
						{ repl },
						signal,
					);
				if (ran.failed) throw new Error(ran.model);
				return ran.model;
			},
		};

		return {
			agents,
			code,
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
