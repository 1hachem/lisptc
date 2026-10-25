import type {
	AgentRunner,
	ChatSeed,
	CodeRunner,
} from "@repo/agents-extension/ports";
import type { RunnerFor } from "@repo/backend/agent-repl";
import type { Id } from "@repo/backend/dataModel";
import type { ThreadHost } from "@repo/backend/thread-host";
import { chatTurns, notice } from "./chat-turns.ts";

export function subAgents(host: ThreadHost): RunnerFor {
	return (_workspaceId, chatId) => {
		async function forkChat(child: Id<"chats">, chat: ChatSeed) {
			if (chat.from === "fresh") return;
			await host.copyTranscript(chatId, child);
		}

		const agents: AgentRunner = {
			async spawn({ definition, seed, chat }) {
				const child = await chatTurns().spawn(chatId, () =>
					host.spawn(
						chatId,
						{
							name: definition.name,
							prompt: definition.prompt,
							bounds:
								definition.permissions === undefined
									? []
									: [definition.permissions],
						},
						seed.from === "fork" ? seed.image : undefined,
					),
				);
				await forkChat(child, chat);
				return child;
			},
			async send(agent, { message, maxSteps, signal }) {
				const outcome = await chatTurns().reply(agent as Id<"chats">, message, {
					maxSteps,
					signal,
				});
				if ("answer" in outcome) return outcome.answer;
				if ("stopped" in outcome) throw new Error(outcome.stopped);
				throw new Error("the agent is still waiting on a human");
			},
		};

		const code: CodeRunner = {
			async run({ source, image }) {
				const repl = await host.fork(chatId, image);
				const ran = await repl.evalOutput(source);
				if (ran.held) throw new Error("background code cannot wait on a human");
				if (ran.failed) throw new Error(ran.model);
				return ran.model;
			},
		};

		return {
			agents,
			code,
			notify: (reply) => notice({ chatId, notice: reply }),
		};
	};
}
