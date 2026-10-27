import type {
	AgentThreads,
	Message,
	Outcome,
	Seen,
	Spawn,
} from "@repo/agents-extension/ports";
import type { TurnOutcome } from "@repo/ai";
import { extract, type Fragment } from "@repo/interpreter/image";
import type { Id } from "../convex/_generated/dataModel.js";
import type { Supervisor } from "./agent-repl.ts";

function outcomeOf(outcome: TurnOutcome): Outcome {
	if ("answer" in outcome) return { reply: outcome.answer };
	if ("stopped" in outcome) return { failure: outcome.stopped };
	return { failure: "the agent is still waiting on a human" };
}

export class SupervisedAgents implements AgentThreads {
	constructor(
		private readonly supervisor: Supervisor,
		private readonly parent: Id<"chats">,
	) {}

	async spawn({ definition, seed, chat }: Spawn): Promise<string> {
		const { name, prompt, permissions, roster, budget } = definition;
		const record = {
			name,
			prompt,
			bounds: permissions === undefined ? [] : [permissions],
			...(roster === undefined ? {} : { roster: [...roster] }),
			...(budget === undefined ? {} : { budget }),
		};
		const image = seed.from === "fork" ? seed.image : undefined;
		const child = (await this.supervisor.threads.spawn(
			this.parent,
			() => this.supervisor.spawn(this.parent, record, image),
			budget === undefined ? undefined : { steps: budget },
		)) as Id<"chats">;
		if (chat.from === "fork")
			await this.supervisor.copyTranscript(this.parent, child);
		return child;
	}

	send(child: string, { text, maxSteps }: Message): Promise<string> {
		return this.supervisor.threads.ask(
			child,
			{
				kind: "event",
				id: crypto.randomUUID(),
				source: `agent:${this.parent}`,
				text,
			},
			{ replyTo: this.parent, maxSteps },
		);
	}

	async wait(job: string, signal: AbortSignal): Promise<Outcome> {
		return outcomeOf(await this.supervisor.threads.wait(job, signal));
	}

	state(job: string): Seen {
		const seen = this.supervisor.threads.state(job);
		if ("thread" in seen)
			return {
				state:
					seen.state === "busy"
						? "pending"
						: seen.state === "idle"
							? "done"
							: "lost",
			};
		return seen.outcome === undefined
			? { state: seen.state }
			: { state: seen.state, outcome: outcomeOf(seen.outcome) };
	}

	cancel(id: string): Promise<boolean> {
		return this.supervisor.threads.cancel(id);
	}

	async read(child: string, name: string): Promise<Fragment> {
		const image = await this.supervisor.image(
			this.parent,
			child as Id<"chats">,
		);
		if (image === undefined) throw new Error("the agent has run nothing yet");
		return extract(image, name);
	}
}
