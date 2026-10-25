import {
	codeRunner,
	MemoryMailbox,
	Threads,
	type TurnSetup,
	type WireMessage,
} from "@repo/ai";
import { backgroundExtension } from "@repo/background-extension";
import { backgroundJobsContract } from "@repo/background-extension/contract";
import { backgroundHostFor, timerSleep } from "@repo/background-extension/host";
import { StepHold } from "@repo/interpreter/errors";
import { type Image, snapshot } from "@repo/interpreter/image";
import type { Interp } from "@repo/interpreter/lisp";
import { newSym } from "@repo/interpreter/objects";
import {
	annotating,
	type InterpExtension,
	type SessionHooks,
} from "@repo/interpreter/session";
import { MemoryImageStore } from "@repo/repl/image-store";
import { AgentRepl } from "@repo/repl/repl";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ChildRecord, Supervisor } from "../../src/agent-repl.ts";
import { SupervisedBackground } from "../../src/background-threads.ts";
import { profileOf, type RecordLineage } from "../../src/thread-host.ts";

const ROOT = "root" as Id<"chats">;

const asking: InterpExtension = Object.assign(
	(interp: Interp) => {
		interp.defineGlobal(
			newSym("ask-human"),
			interp.makeBuiltIn("ask-human", 0, () => {
				throw new StepHold("approve it");
			}),
		);
	},
	{
		session: (hooks: SessionHooks) =>
			hooks.annotate.use((buffer, into, next) =>
				next(buffer, annotating(into, "output", { asked: true })),
			),
	},
);

class World {
	readonly records = new Map<string, { agent: ChildRecord; parent: string }>();
	readonly images = new Map<string, Image>();
	readonly stored = new Map<string, WireMessage[]>();
	readonly threads: Threads;
	readonly jobs: SupervisedBackground;
	private made = 0;

	constructor() {
		this.threads = new Threads({
			ports: {
				mailbox: new MemoryMailbox(),
				transcript: {
					read: async (id) => [...(this.stored.get(id) ?? [])],
					append: async (id, messages) => {
						this.stored.set(id, [...(this.stored.get(id) ?? []), ...messages]);
					},
					annotate: async () => {},
				},
				status: { start: async () => {}, settle: async () => {} },
				setup: async (id) => this.setup(id),
			},
			repl: (id) => this.repl(id),
			lineage: (id) => {
				const record = this.records.get(id);
				return record === undefined ? {} : { parent: record.parent };
			},
		});
		const supervisor: Supervisor = {
			threads: this.threads,
			spawn: async (parent, agent, image) => {
				this.made += 1;
				const id = `job-thread-${this.made}` as Id<"chats">;
				this.records.set(id, { agent, parent });
				if (image !== undefined) this.images.set(id, image);
				return id;
			},
			copyTranscript: async () => {},
		};
		this.jobs = new SupervisedBackground(supervisor, timerSleep);
	}

	lineage(id: string): RecordLineage {
		const chain: RecordLineage = [];
		for (let at: string | undefined = id; at !== undefined; ) {
			const record = this.records.get(at);
			chain.push(record === undefined ? {} : { agent: record.agent });
			at = record?.parent;
		}
		return chain;
	}

	setup(id: string): TurnSetup {
		const profile = profileOf(this.lineage(id));
		return {
			runsForms: false,
			...(profile.deadlineMs === undefined
				? {}
				: { deadlineMs: profile.deadlineMs }),
			...(profile.code === undefined
				? {}
				: { runner: codeRunner(profile.code) }),
		};
	}

	async repl(id: string): Promise<AgentRepl> {
		const images = new MemoryImageStore();
		const image = this.images.get(id);
		if (image !== undefined) await images.save(image);
		const repl = new AgentRepl({
			extensions: [
				backgroundExtension(backgroundHostFor({ jobs: this.jobs, thread: id })),
				...(id === ROOT ? [] : [asking]),
			],
			images,
		});
		await repl.resume().catch(() => undefined);
		return repl;
	}

	heard(id: string, source: string): WireMessage | undefined {
		return (this.stored.get(id) ?? []).find(
			(m) => m.additional_kwargs?.source === source,
		);
	}

	child(): string {
		const [id] = [...this.records.keys()].filter((key) =>
			key.startsWith("job-thread-"),
		);
		return id ?? "";
	}
}

function spec(code: string) {
	return {
		parent: ROOT,
		code,
		fork: null,
		permissions: null,
		deadlineSeconds: null,
	};
}

backgroundJobsContract("the supervised background adapter", async () => ({
	jobs: new World().jobs,
	parent: ROOT,
}));

describe("the background threads adapter", () => {
	it("starts a fresh REPL, or a forked one carrying the caller's image", async () => {
		const world = new World();
		const root = await world.repl(ROOT);
		await root.eval("(setq secret 41)");
		const signal = new AbortController().signal;
		const forked = await world.jobs.start({
			...spec("(+ secret 1)"),
			fork: snapshot(root.interp),
		});
		expect(await world.jobs.wait(forked, signal)).toEqual({ value: "42" });
		const fresh = await world.jobs.start(spec("(+ secret 1)"));
		expect(await world.jobs.wait(fresh, signal)).toMatchObject({
			failure: expect.stringContaining("secret"),
		});
	});

	it("narrows the job by its permissions on top of every bound above it", async () => {
		const world = new World();
		world.records.set("lead", {
			parent: ROOT,
			agent: {
				name: "lead",
				prompt: "p",
				bounds: ['(permission/deny "fs/*")'],
			},
		});
		await world.jobs.start({
			...spec("1"),
			parent: "lead",
			permissions: '(permission/deny "net/*")',
			deadlineSeconds: 5,
		});
		const profile = profileOf(world.lineage(world.child()));
		expect(profile.bounds).toEqual([
			'(permission/deny "net/*")',
			'(permission/deny "fs/*")',
		]);
		expect(profile.code).toBe("1");
		expect(profile.deadlineMs).toBe(5000);
		expect(profile.instructions).toBeUndefined();
	});

	it("inherits the parent's bounds when it names none", async () => {
		const world = new World();
		await world.jobs.start(spec("1"));
		expect(world.records.get(world.child())?.agent.bounds).toEqual([]);
	});

	it("wakes the parent with the value under background:<job>", async () => {
		const world = new World();
		const job = await world.jobs.start(spec("(* 6 7)"));
		await vi.waitFor(() =>
			expect(world.heard(ROOT, `background:${job}`)?.content).toContain("42"),
		);
	});

	it("brings an ask from background code to the root chat", async () => {
		const world = new World();
		const job = await world.jobs.start(spec("(ask-human)"));
		await vi.waitFor(() => expect(world.jobs.state(job).state).toBe("held"));
		expect(
			(world.stored.get(ROOT) ?? []).some(
				(m) => m.additional_kwargs?.asked === true,
			),
		).toBe(true);
	});
});
