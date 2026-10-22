import type { Ask } from "@repo/interpreter/asks";
import { type KwargMessage, lighten } from "@repo/shared/messages";

type Kwargs = Record<string, unknown>;

interface WireMessage extends KwargMessage {
	id: string;
}

export type Beat =
	| { kind: "say"; text: string; thinking?: string }
	| { kind: "live"; kwargs: Kwargs; ms?: number }
	| { kind: "result"; output?: string; kwargs?: Kwargs }
	| { kind: "pause"; ms: number }
	| { kind: "fail"; message: string };

export interface Scenario {
	id: string;
	label: string;
	prompt: string;
	beats: Beat[];
	next?: (answer: string) => string | undefined;
}

const say = (text: string, thinking?: string): Beat => ({
	kind: "say",
	text,
	...(thinking === undefined ? {} : { thinking }),
});
const live = (kwargs: Kwargs, ms = 900): Beat => ({ kind: "live", kwargs, ms });
const result = (kwargs: Kwargs = {}, output = "ok"): Beat => ({
	kind: "result",
	kwargs,
	output,
});

const todos = (done: number, labels: string[]) =>
	labels.map((label, at) => ({ label, done: at < done }));

const PLAN = ["read the notes", "group the topics", "write the summary"];

const WRITE_ASK: Ask = {
	id: "ask-write",
	title: '(fs/write "summary.md")',
	detail: "write 2.1 KB to summary.md",
	prompt: "Let the agent write this file?",
	choices: [
		{
			label: "Allow once",
			done: "Allowed once",
			accepts: true,
			primary: true,
			answer: { action: "permissions/decide", values: { decision: "once" } },
		},
		{
			label: "Always allow",
			done: "Always allowed",
			accepts: true,
			answer: { action: "permissions/decide", values: { decision: "always" } },
		},
		{
			label: "Deny",
			done: "Denied",
			accepts: false,
			answer: { action: "permissions/decide", values: { decision: "deny" } },
		},
	],
};

const SIGN_IN_ASK: Ask = {
	id: "ask-sign-in",
	title: "linear",
	prompt: "Sign in to Linear so the agent can read your issues.",
	choices: [
		{
			label: "Skip",
			done: "Skipped",
			accepts: false,
			answer: { action: "mcp/skip", values: { server: "linear" } },
		},
	],
};

const CARD = {
	tag: "card",
	props: { title: "Weekly summary" },
	children: [
		{
			tag: "text",
			props: { text: "12 notes read, 3 topics found." },
			children: [],
		},
		{
			tag: "row",
			props: {},
			children: ["planning", "hiring", "infra"].map((text) => ({
				tag: "badge",
				props: { text },
				children: [],
			})),
		},
	],
};

export const SCENARIOS: Scenario[] = [
	{
		id: "text",
		label: "Plain text",
		prompt: "tell me about lisptc",
		beats: [
			say(
				"lisptc is a Lisp that acts as the deterministic brain of an agent.\n\nThe model writes **forms**, the interpreter runs them, and the results come back as the next message. Everything the agent does goes through a form, so a turn can be replayed step by step.",
			),
		],
	},
	{
		id: "thinking",
		label: "Thinking",
		prompt: "which of my notes is the oldest?",
		beats: [
			say(
				'I will list the notes with their dates.\n(fs/list "notes/" :dates t)',
				"The person wants the oldest note. I do not know the dates yet, so I should list the folder with modification times rather than guess from the names. Names like a.md and b.md say nothing about age. One call with :dates t gives me everything, then I can sort and answer without reading every file.",
			),
			result(
				{ intent: { doing: "listing notes/ with dates" } },
				'(("a.md" "2024-03-02") ("b.md" "2023-11-18") ("c.md" "2025-01-09"))',
			),
			say(
				"The oldest is **b.md**, last changed on 18 November 2023.",
				"Three dates. 2023-11-18 is the earliest, so b.md. c.md is the newest. No need for another call, I can answer now.",
			),
		],
	},
	{
		id: "tools",
		label: "Text + tool calls",
		prompt: "summarise my notes",
		beats: [
			say(
				'Let me read your notes first.\n(intent/todo \'("read the notes" "group the topics" "write the summary"))\n(fs/list "notes/")',
			),
			live({ intent: { doing: "listing notes/", todos: todos(0, PLAN) } }),
			result(
				{
					intent: { todos: todos(1, PLAN) },
					results: ['("a.md" "b.md" "c.md")'],
				},
				'("a.md" "b.md" "c.md")',
			),
			say(
				'Three files. Reading them now.\n(map fs/read \'("a.md" "b.md" "c.md"))',
			),
			live({
				intent: {
					doing: "reading 3 notes",
					todos: todos(1, PLAN),
					progress: { done: 1, total: 3, label: "notes" },
				},
			}),
			live({
				intent: {
					doing: "reading 3 notes",
					todos: todos(1, PLAN),
					progress: { done: 2, total: 3, label: "notes" },
				},
			}),
			result({ intent: { todos: todos(2, PLAN) } }),
			say('(ui/show (card "Weekly summary" ...))'),
			result({ intent: { todos: todos(3, PLAN) }, ui: CARD }),
			say(
				"Your notes cover **planning**, **hiring** and **infra**. Planning takes the most room: four of the twelve notes are about the Q4 roadmap.",
			),
		],
	},
	{
		id: "activity",
		label: "Activity log",
		prompt: "check the deploy",
		beats: [
			say('(mcp/call "argocd" "get_application" {:name "app"})'),
			live({
				activity: [
					{
						kind: "mcp",
						label: "argocd get_application",
						state: "started",
						id: "x1",
					},
				],
			}),
			result({
				activity: [
					{
						kind: "mcp",
						label: "argocd get_application",
						state: "done",
						id: "x1",
						ms: 640,
					},
				],
				intent: {
					log: [
						{
							text: "read the app status",
							startedAt: new Date().toISOString(),
							ms: 640,
							state: "done",
						},
						{
							text: "read the pod logs",
							startedAt: new Date().toISOString(),
							state: "failed",
						},
					],
				},
			}),
			say(
				"The app is synced and healthy. I could not read the pod logs: the token lacks the `logs` scope.",
			),
		],
	},
	{
		id: "question",
		label: "Agent asks a question",
		prompt: "plan my week",
		beats: [
			say(
				'Before I plan, one question.\n(intent/ask "What should I prioritise?" \'("Deep work" "Meetings" "Admin") :multi t)',
			),
			result({
				question: {
					id: "q1",
					prompt: "What should I prioritise?",
					choices: ["Deep work", "Meetings", "Admin"],
					multi: true,
				},
			}),
		],
		next: () => "after-question",
	},
	{
		id: "approval",
		label: "Permission ask",
		prompt: "write the summary to a file",
		beats: [
			say('Writing it to summary.md.\n(fs/write "summary.md" summary)'),
			result({ asks: { open: [WRITE_ASK] } }, "waiting on approval"),
		],
		next: (answer) => (answer === "Denied" ? "denied" : "allowed"),
	},
	{
		id: "sign-in",
		label: "Sign-in ask",
		prompt: "what is assigned to me in linear?",
		beats: [
			say('(mcp/call "linear" "list_issues" {:assignee "me"})'),
			result({ asks: { open: [SIGN_IN_ASK] } }, "linear needs a sign-in"),
		],
		next: () => "denied",
	},
	{
		id: "failure",
		label: "Failed step",
		prompt: "read the missing file",
		beats: [
			say('(fs/read "missing.md")'),
			result({ failed: true }, "error: no such file missing.md"),
			say("That file does not exist. Want me to list what is there instead?"),
		],
	},
	{
		id: "error",
		label: "Stream error",
		prompt: "break the stream",
		beats: [
			say("Starting on it, this will take a moment…"),
			{ kind: "pause", ms: 600 },
			{ kind: "fail", message: "the model provider returned 529: overloaded" },
		],
	},
	{
		id: "long",
		label: "Long stream",
		prompt: "write me a long answer",
		beats: [
			say(
				Array.from(
					{ length: 8 },
					(_, at) =>
						`## Part ${at + 1}\n\nThis paragraph streams word by word so the scroll, the markdown and the stop button can be tried on a long reply. It carries a list too:\n\n- one point\n- another point\n- a \`code\` span`,
				).join("\n\n"),
			),
		],
	},
];

const FOLLOW_UPS: Scenario[] = [
	{
		id: "after-question",
		label: "",
		prompt: "",
		beats: [
			say(
				"Got it. I'll block your mornings for that and keep the rest of the week open.",
			),
		],
	},
	{
		id: "allowed",
		label: "",
		prompt: "",
		beats: [
			live({ intent: { doing: "writing summary.md" } }, 700),
			result({}, "wrote summary.md"),
			say("Done, the summary is in `summary.md`."),
		],
	},
	{
		id: "denied",
		label: "",
		prompt: "",
		beats: [say("Okay, I left it alone.")],
	},
];

function scenario(id: string | undefined): Scenario | undefined {
	return [...SCENARIOS, ...FOLLOW_UPS].find((s) => s.id === id);
}

function echo(text: string): Scenario {
	return {
		id: "echo",
		label: "",
		prompt: "",
		beats: [
			say(
				`You said: *${text}*.\n\nPick a scenario on the left to see a scripted turn, or keep typing to get this echo back.`,
			),
		],
	};
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

interface Ticket {
	messageId: string;
	askId: string;
	label: string;
	accepted: boolean;
}

export class MockAgent {
	speed = 1;
	private wire: WireMessage[] = [];
	private saved: WireMessage[] = [];
	private readonly listeners = new Set<() => void>();
	private queued: string | undefined;
	private pending: Scenario["next"];

	queue(id: string): void {
		this.queued = id;
	}

	reset(): void {
		this.wire = [];
		this.queued = undefined;
		this.pending = undefined;
		this.save();
	}

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	readonly transcript = (): WireMessage[] => this.saved;

	private save(): void {
		this.saved = structuredClone(this.wire);
		for (const listener of this.listeners) listener();
	}

	readonly fetch = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = String(input instanceof Request ? input.url : input);
		const body = JSON.parse(String(init?.body ?? "{}"));
		if (url.endsWith("/api/ui-action")) return this.uiAction(body);
		if (url.endsWith("/api/chat/steer")) return Response.json({ ok: true });
		return this.turn(body.input ?? {}, init?.signal ?? undefined);
	};

	private turn(
		input: { message?: string; event?: { token: string } },
		signal: AbortSignal | undefined,
	): Response {
		let answer = input.message ?? "";
		if (input.event) answer = this.answer(JSON.parse(input.event.token));
		else
			this.wire.push({
				type: "human",
				content: answer,
				id: crypto.randomUUID(),
			});

		this.save();

		const picked =
			scenario(this.queued) ?? scenario(this.pending?.(answer)) ?? echo(answer);
		this.queued = undefined;
		this.pending = picked.next;

		const body = new ReadableStream<Uint8Array>({
			start: (controller) => {
				this.play(picked, controller, signal).finally(() => {
					try {
						controller.close();
					} catch {}
				});
			},
		});
		return new Response(body, {
			headers: { "content-type": "text/event-stream; charset=utf-8" },
		});
	}

	private answer(ticket: Ticket): string {
		const at = this.wire.findIndex((m) => m.id === ticket.messageId);
		const message = this.wire[at];
		if (message !== undefined) {
			const asks = (message.additional_kwargs?.asks ?? {}) as {
				answered?: Record<string, unknown>;
			};
			this.wire[at] = {
				...message,
				additional_kwargs: {
					...message.additional_kwargs,
					asks: {
						...asks,
						answered: {
							...asks.answered,
							[ticket.askId]: {
								accepted: ticket.accepted,
								label: ticket.label,
							},
						},
					},
				},
			};
		}
		this.wire.push({
			type: "system",
			content: `I answered "${ticket.label}". Carry on.`,
			id: crypto.randomUUID(),
			additional_kwargs: { source: "permissions/decide" },
		});
		return ticket.label;
	}

	private uiAction(body: {
		messageId?: string;
		action: string;
		values: Record<string, unknown>;
	}): Response {
		const message = this.wire.find((m) => m.id === body.messageId);
		const open = ((message?.additional_kwargs?.asks as { open?: Ask[] })
			?.open ?? []) as Ask[];
		for (const ask of open) {
			const choice = ask.choices.find(
				(c) =>
					c.answer.action === body.action &&
					JSON.stringify(c.answer.values) === JSON.stringify(body.values),
			);
			if (choice === undefined || body.messageId === undefined) continue;
			const ticket: Ticket = {
				messageId: body.messageId,
				askId: ask.id,
				label: choice.done ?? choice.label,
				accepted: choice.accepts,
			};
			return Response.json({
				output: "",
				event: {
					token: JSON.stringify(ticket),
					source: "permissions/decide",
					text: `I answered "${ticket.label}". Carry on.`,
				},
			});
		}
		return Response.json({ output: "no such ask", error: true });
	}

	private async play(
		picked: Scenario,
		controller: ReadableStreamDefaultController<Uint8Array>,
		signal: AbortSignal | undefined,
	): Promise<void> {
		const wait = (ms: number) =>
			new Promise<void>((done, fail) => {
				const timer = setTimeout(done, ms / this.speed);
				signal?.addEventListener("abort", () => {
					clearTimeout(timer);
					fail(new Error("aborted"));
				});
			});
		let provisional: WireMessage | undefined;
		let intent: Kwargs | undefined;
		const holding = (kwargs: Kwargs | undefined): Kwargs => {
			const next = kwargs?.intent as Kwargs | undefined;
			if (next) intent = { ...intent, ...next };
			return intent ? { ...kwargs, intent } : { ...kwargs };
		};
		let lastAi: WireMessage | undefined;
		let steps = 0;
		const snapshot = () => {
			const shown = provisional ? [...this.wire, provisional] : this.wire;
			controller.enqueue(sse("values", { messages: lighten(shown) }));
		};

		try {
			await wait(250);
			for (const beat of picked.beats) {
				if (beat.kind === "pause") await wait(beat.ms);
				if (beat.kind === "say") {
					const id = crypto.randomUUID();
					const started = Date.now();
					for (const chunk of beat.thinking?.match(/\S+\s*|\s+/g) ?? []) {
						controller.enqueue(
							sse("messages", [
								{
									type: "ai",
									id,
									content: "",
									additional_kwargs: { reasoning_content: chunk },
								},
								{},
							]),
						);
						await wait(18);
					}
					for (const chunk of beat.text.match(/\S+\s*|\s+/g) ?? []) {
						controller.enqueue(
							sse("messages", [{ type: "ai", id, content: chunk }, {}]),
						);
						await wait(28);
					}
					steps += 1;
					lastAi = {
						type: "ai",
						content: beat.text,
						id,
						additional_kwargs: {
							...(beat.thinking ? { reasoning_content: beat.thinking } : {}),
							meta: {
								at: new Date().toISOString(),
								durationMs: Date.now() - started,
								provider: "mock",
								model: "mock-1",
								inputTokens: 1200 + steps * 300,
								outputTokens: beat.text.length,
							},
						},
					};
					this.wire.push(lastAi);
				}
				if (beat.kind === "live") {
					provisional = {
						type: "tool",
						content: "",
						id: `${lastAi?.id ?? "step"}:live`,
						additional_kwargs: holding(beat.kwargs),
					};
					snapshot();
					await wait(beat.ms ?? 900);
				}
				if (beat.kind === "result") {
					provisional = undefined;
					this.wire.push({
						type: "tool",
						content: JSON.stringify({
							source: "lisp-repl",
							output: beat.output ?? "ok",
						}),
						id: crypto.randomUUID(),
						additional_kwargs: {
							display: beat.output ?? "",
							...holding(beat.kwargs),
						},
					});
					this.save();
					snapshot();
					await wait(300);
				}
				if (beat.kind === "fail") {
					controller.enqueue(
						sse("error", { error: "AgentError", message: beat.message }),
					);
					return;
				}
			}
			provisional = undefined;
			const meta = lastAi?.additional_kwargs?.meta as Kwargs | undefined;
			if (meta) meta.steps = steps;
			snapshot();
		} catch {
			provisional = undefined;
		} finally {
			this.save();
		}
	}
}
