import type {
	ChatMessageInput,
	Lineage,
	Mailbox,
	ThreadStatus,
	Threads,
	ThreadsHost,
	TranscriptStore,
	TurnSetup,
	WireMessage,
} from "@repo/ai";
import type { Image } from "@repo/interpreter/image";
import { type ImageStore, MemoryImageStore } from "@repo/repl/image-store";
import { AgentRepl } from "@repo/repl/repl";
import { DEFAULT_CHOICE } from "@repo/shared/providers";
import type { FunctionReturnType } from "convex/server";
import { internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { MAX_SPAWN_DEPTH, TURN_DEADLINE_MS } from "../convex/limits.js";
import {
	type ChildRecord,
	type WorkspaceClient,
	workspaceExtensions,
} from "./agent-repl.ts";
import { ConvexImageStore } from "./image-store.ts";
import type { Owner, ServerClient } from "./server-client.ts";

type RecordLineage = FunctionReturnType<
	typeof internal.threads.record
>["lineage"];

export interface ThreadProfile {
	readonly instructions?: string;
	readonly bounds: readonly string[];
	readonly roster?: readonly string[];
	readonly budget?: number;
}

function narrowed(
	roster: readonly string[] | undefined,
	by: readonly string[] | undefined,
): readonly string[] | undefined {
	if (by === undefined) return roster;
	if (roster === undefined) return by;
	return roster.filter((name) => by.includes(name));
}

export function profileOf(lineage: RecordLineage): ThreadProfile {
	const agents = lineage.flatMap(({ agent }) =>
		agent === undefined ? [] : [agent],
	);
	const roster = agents.reduce<readonly string[] | undefined>(
		(kept, agent) => narrowed(kept, agent.roster),
		undefined,
	);
	const budgets = agents.flatMap(({ budget }) =>
		budget === undefined ? [] : [budget],
	);
	const instructions = lineage[0]?.agent?.prompt;
	return {
		...(instructions === undefined ? {} : { instructions }),
		bounds: [...new Set(agents.flatMap((agent) => agent.bounds))],
		...(lineage.length > MAX_SPAWN_DEPTH
			? { roster: [] }
			: roster === undefined
				? {}
				: { roster }),
		...(budgets.length === 0 ? {} : { budget: Math.min(...budgets) }),
	};
}

interface StoredMessage {
	_id: string;
	wireId?: string;
	type: "human" | "ai" | "system" | "tool";
	content: string;
	kwargs?: Record<string, unknown>;
}

const STORED_TYPES = new Set<string>(["human", "ai", "system", "tool"]);

function isStored(
	message: WireMessage,
): message is WireMessage & { type: StoredMessage["type"] } {
	return STORED_TYPES.has(message.type);
}

function toInput(stored: StoredMessage[]): ChatMessageInput[] {
	return stored.map((message) => ({
		id: message.wireId ?? message._id,
		type: message.type,
		content: message.content,
		additional_kwargs: message.kwargs,
	}));
}

function toStored(wire: WireMessage[]) {
	return wire.filter(isStored).map((message) => ({
		id: message.id,
		type: message.type,
		content: message.content,
		kwargs: message.additional_kwargs,
	}));
}

export interface ThreadHostOptions {
	readonly server: ServerClient;
	readonly actAs: (owner: Owner) => WorkspaceClient;
	readonly threads?: () => Threads;
}

const asChat = (threadId: string) => threadId as Id<"chats">;

export class ThreadHost {
	readonly transcript: TranscriptStore;
	readonly status: ThreadStatus;

	constructor(private readonly options: ThreadHostOptions) {
		const { server } = options;
		this.transcript = {
			async read(threadId) {
				return toInput(
					await server.query(internal.threads.transcript, {
						chatId: asChat(threadId),
					}),
				);
			},
			async append(threadId, messages) {
				await server.mutation(internal.threads.append, {
					chatId: asChat(threadId),
					messages: toStored(messages),
				});
			},
			async annotate(threadId, id, kwargs) {
				await server.mutation(internal.threads.annotate, {
					chatId: asChat(threadId),
					id,
					kwargs,
				});
			},
		};
		this.status = {
			async start(threadId) {
				await server.mutation(internal.threads.start, {
					chatId: asChat(threadId),
				});
			},
			async settle(threadId, failure) {
				await server.mutation(internal.threads.settle, {
					chatId: asChat(threadId),
					failure,
				});
			},
		};
	}

	async record(threadId: string) {
		const { lineage, ...record } = await this.options.server.query(
			internal.threads.record,
			{ chatId: asChat(threadId) },
		);
		return {
			...record,
			profile: profileOf(lineage),
			budget: lineage[0]?.agent?.budget,
		};
	}

	async lineage(threadId: string): Promise<Lineage> {
		const { parentId, title, budget } = await this.record(threadId);
		return {
			...(parentId === undefined ? {} : { parent: parentId }),
			title,
			...(budget === undefined ? {} : { limits: { steps: budget } }),
		};
	}

	async setup(threadId: string): Promise<TurnSetup> {
		const { model, runsForms, profile } = await this.record(threadId);
		const { provider, model: name } = model ?? DEFAULT_CHOICE;
		return {
			config: {
				provider,
				model: name,
				...(profile.instructions === undefined
					? {}
					: { instructions: profile.instructions }),
			},
			runsForms,
			deadlineMs: TURN_DEADLINE_MS,
		};
	}

	supervised(mailbox: Mailbox): ThreadsHost {
		return {
			ports: {
				mailbox,
				transcript: this.transcript,
				status: this.status,
				setup: (threadId) => this.setup(threadId),
			},
			repl: (threadId) => this.repl(asChat(threadId)),
			lineage: (threadId) => this.lineage(threadId),
		};
	}

	async spawn(
		parent: Id<"chats">,
		agent: ChildRecord,
		image?: Image,
	): Promise<Id<"chats">> {
		const { server } = this.options;
		const chatId = await server.mutation(internal.threads.spawn, {
			chatId: parent,
			agent,
		});
		if (image !== undefined) {
			const replId = await server.mutation(internal.threads.repl, { chatId });
			await new ConvexImageStore(replId, server).save(image);
		}
		return chatId;
	}

	async copyTranscript(from: Id<"chats">, to: Id<"chats">): Promise<void> {
		const { server } = this.options;
		const earlier = await server.query(internal.threads.transcript, {
			chatId: from,
		});
		if (earlier.length === 0) return;
		await server.mutation(internal.threads.append, {
			chatId: to,
			messages: earlier.map(({ wireId, type, content, kwargs }) => ({
				...(wireId === undefined ? {} : { id: wireId }),
				type,
				content,
				...(kwargs === undefined ? {} : { kwargs }),
			})),
		});
	}

	async fork(threadId: Id<"chats">, image: Image): Promise<AgentRepl> {
		const images = new MemoryImageStore();
		await images.save(image);
		return await this.build(threadId, images, false);
	}

	async repl(chatId: Id<"chats">): Promise<AgentRepl> {
		const replId = await this.options.server.mutation(internal.threads.repl, {
			chatId,
		});
		return await this.build(
			chatId,
			new ConvexImageStore(replId, this.options.server),
			true,
		);
	}

	private async build(
		chatId: Id<"chats">,
		images: ImageStore,
		own: boolean,
	): Promise<AgentRepl> {
		const { workspaceId, ownerId, profile } = await this.record(chatId);
		const { actAs, threads } = this.options;
		const owner = actAs({ userId: ownerId, workspaceId });
		const supervisor =
			own && threads !== undefined
				? {
						threads: threads(),
						spawn: (parent: Id<"chats">, agent: ChildRecord, image?: Image) =>
							this.spawn(parent, agent, image),
						copyTranscript: (from: Id<"chats">, to: Id<"chats">) =>
							this.copyTranscript(from, to),
					}
				: undefined;
		const repl = new AgentRepl({
			extensions: await workspaceExtensions(workspaceId, () => owner, {
				bounds: profile.bounds,
				...(profile.roster === undefined ? {} : { roster: profile.roster }),
				...(own ? { chatId } : {}),
				...(supervisor === undefined ? {} : { supervisor }),
			}),
			images,
		});
		await repl.resume().catch((ex) => {
			console.error(`[backend] chat ${chatId} resumed fresh:`, ex);
		});
		return repl;
	}
}
