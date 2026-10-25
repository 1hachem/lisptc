import type { TurnOutcome } from "@repo/ai";
import type {
	BackgroundJobs,
	JobSpec,
	Outcome,
	Seen,
} from "@repo/background-extension/ports";
import type { Id } from "../convex/_generated/dataModel.js";
import type { Supervisor } from "./agent-repl.ts";

function outcomeOf(outcome: TurnOutcome): Outcome {
	if ("answer" in outcome) return { value: outcome.answer };
	if ("stopped" in outcome) return { failure: outcome.stopped };
	return { failure: "the job is still waiting on a human" };
}

export class SupervisedBackground implements BackgroundJobs {
	constructor(
		private readonly supervisor: Supervisor,
		readonly sleep: BackgroundJobs["sleep"],
	) {}

	async start(spec: JobSpec): Promise<string> {
		const { threads } = this.supervisor;
		const parent = spec.parent as Id<"chats">;
		const deadlineMs =
			spec.deadlineSeconds === null ? undefined : spec.deadlineSeconds * 1000;
		const record = {
			name: "background",
			prompt: "",
			code: spec.code,
			bounds: spec.permissions === null ? [] : [spec.permissions],
			...(deadlineMs === undefined ? {} : { deadlineMs }),
		};
		const child = await threads.spawn(
			parent,
			() => this.supervisor.spawn(parent, record, spec.fork ?? undefined),
			deadlineMs === undefined
				? undefined
				: { deadline: Date.now() + deadlineMs },
		);
		return await threads.ask(
			child,
			{
				kind: "event",
				id: crypto.randomUUID(),
				source: `background:${parent}`,
				text: spec.code,
			},
			{ replyTo: parent, replyAs: "background" },
		);
	}

	async wait(job: string, signal: AbortSignal): Promise<Outcome> {
		return outcomeOf(await this.supervisor.threads.wait(job, signal));
	}

	state(job: string): Seen {
		const seen = this.supervisor.threads.state(job);
		if ("thread" in seen) return { state: "lost" };
		return seen.outcome === undefined
			? { state: seen.state }
			: { state: seen.state, outcome: outcomeOf(seen.outcome) };
	}

	cancel(job: string): Promise<boolean> {
		return this.supervisor.threads.cancel(job);
	}
}
