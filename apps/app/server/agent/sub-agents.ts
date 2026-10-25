import type {
	AgentRunner,
	ChatSeed,
	CodeRunner,
} from "@repo/agents-extension/ports";
import { converse, type ReplSource, type WireMessage } from "@repo/ai";
import type { RunnerFor } from "@repo/backend/agent-repl";
import type { Id } from "@repo/backend/dataModel";
import type { ThreadHost } from "@repo/backend/thread-host";
import type { StepAnnotations } from "@repo/interpreter/session";
import { chatTurns, notice } from "./chat-turns.ts";
import { delegated } from "./delegated.ts";

export type Relay = (chatId: Id<"chats">, message: WireMessage) => void;

export function subAgents(host: ThreadHost, relay: Relay): RunnerFor {
	return (_workspaceId, chatId) => {
		async function forkChat(child: Id<"chats">, chat: ChatSeed) {
			if (chat.from === "fresh") return;
			await host.copyTranscript(chatId, child);
		}

		async function surface<Id extends string>(
			who: string,
			held: StepAnnotations,
			source: ReplSource<Id>,
			signal: AbortSignal,
		): Promise<string> {
			const id = crypto.randomUUID();
			const answered = delegated.wait(id, source, signal);
			const message: WireMessage = {
				id,
				type: "tool",
				content: `${who} is waiting on you`,
				additional_kwargs: held.output,
			};
			await host.transcript.append(chatId, [message]);
			relay(chatId, message);
			return answered;
		}

		const agents: AgentRunner = {
			async spawn({ definition, seed, chat }) {
				const child = await host.spawn(chatId, definition, seed);
				await forkChat(child, chat);
				return child;
			},
			async send(agent, { message, maxSteps, signal }) {
				const child = agent as Id<"chats">;
				const { title } = await host.record(child);
				return converse(
					(said) => chatTurns().reply(child, said, { maxSteps, signal }),
					message,
					(held) =>
						surface(`agent ${title}`, held, chatTurns().source(child), signal),
				);
			},
		};

		const code: CodeRunner = {
			async run({ source, image }, signal) {
				const repl = await host.fork(chatId, image);
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
			notify: (reply) => notice({ chatId, notice: reply }),
		};
	};
}
