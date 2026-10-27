import {
	type AgentThreads,
	type Message,
	type Outcome,
	PARENT_NAME,
	type Seen,
	type Sent,
	type Spawn,
} from "@repo/agents-extension/ports";
import type { TurnOutcome } from "@repo/ai";
import { extract, type Fragment } from "@repo/interpreter/image";
import type { Id } from "../convex/_generated/dataModel.js";
import type { Supervisor } from "./agent-repl.ts";

const PARENT_SOURCE = `agent:${PARENT_NAME}`;

const UNSENT = "that agent was sent nothing since the runtime started";

function outcomeOf(outcome: TurnOutcome): Outcome {
	if ("answer" in outcome) return { reply: outcome.answer };
	if ("stopped" in outcome) return { failure: outcome.stopped };
	return { failure: "the agent is still waiting on a human" };
}

export class SupervisedAgents implements AgentThreads {
	private readonly children = new Map<string, Id<"chats">>();

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
		const conversation = chat.from === "fork" ? chat.entries : [];
		const childSeed =
			seed.from === "fork"
				? { image: seed.image, conversation }
				: { conversation };
		const child = (await this.supervisor.threads.spawn(
			this.parent,
			name,
			() => this.supervisor.spawn(this.parent, record, childSeed),
			budget === undefined ? undefined : { steps: budget },
		)) as Id<"chats">;
		this.children.set(name, child);
		if (chat.from === "fork")
			await this.supervisor.copyTranscript(this.parent, child);
		return child;
	}

	async send(agent: string, { text, maxSteps }: Message): Promise<Sent> {
		const chat = await this.child(agent);
		const job = await this.supervisor.threads.ask(
			chat,
			{
				kind: "event",
				id: crypto.randomUUID(),
				source: PARENT_SOURCE,
				text,
			},
			{ replyTo: this.parent, maxSteps },
		);
		return { job, chat };
	}

	async wait(agent: string, signal: AbortSignal): Promise<Outcome> {
		const job = await this.latest(agent);
		if (job === undefined) return { failure: UNSENT };
		return outcomeOf(await this.supervisor.threads.wait(job, signal));
	}

	async state(agent: string): Promise<Seen> {
		const job = await this.latest(agent);
		if (job === undefined) return { state: "idle" };
		const seen = this.supervisor.threads.state(job);
		if ("thread" in seen) return { state: "lost" };
		return seen.outcome === undefined
			? { state: seen.state }
			: { state: seen.state, outcome: outcomeOf(seen.outcome) };
	}

	async cancel(agent: string): Promise<boolean> {
		const { threads } = this.supervisor;
		const job = await this.latest(agent);
		const withdrawn = job !== undefined && (await threads.cancel(job));
		const halted = await threads.cancel(await this.child(agent));
		return withdrawn || halted;
	}

	async read(agent: string, global: string): Promise<Fragment> {
		const image = await this.supervisor.image(
			this.parent,
			await this.child(agent),
		);
		if (image === undefined) throw new Error("the agent has run nothing yet");
		return extract(image, global);
	}

	private async latest(agent: string): Promise<string | undefined> {
		return this.supervisor.threads.latest(await this.child(agent));
	}

	private async child(agent: string): Promise<Id<"chats">> {
		const known =
			this.children.get(agent) ??
			(await this.supervisor.child(this.parent, agent));
		if (known === undefined) throw new Error(`no agent named ${agent}`);
		this.children.set(agent, known);
		return known;
	}
}
