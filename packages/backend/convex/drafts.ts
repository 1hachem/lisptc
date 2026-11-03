import {
	PersistentTextStreaming,
	type StreamId,
	StreamIdValidator,
} from "@convex-dev/persistent-text-streaming";
import type { AgentConfig } from "@repo/ai";
import type { ModelRequest, ModelUsage } from "@repo/interpreter/session";
import { v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
	type ActionCtx,
	env,
	httpAction,
	internalMutation,
	type MutationCtx,
	query,
} from "./_generated/server.js";
import { requireChat } from "./lib/auth.js";
import { encodeDelta, endsSentence, type StreamedDelta } from "./lib/deltas.js";
import { streamCompletion, upstreamFor } from "./lib/model.js";
import { posthog } from "./posthog.js";

const streaming = new PersistentTextStreaming(
	components.persistentTextStreaming,
);

interface ModelCall {
	readonly streamId: StreamId;
	readonly request: ModelRequest;
	readonly config: AgentConfig;
}

export const open = internalMutation({
	args: { chatId: v.id("chats"), stepId: v.string() },
	returns: v.object({ streamId: StreamIdValidator, token: v.string() }),
	handler: async (ctx, { chatId, stepId }) => {
		const streamId = await streaming.createStream(ctx);
		const token = crypto.randomUUID();
		await ctx.db.insert("drafts", {
			chatId,
			stepId,
			streamId,
			token,
			claimed: false,
		});
		return { streamId, token };
	},
});

export const claim = internalMutation({
	args: { streamId: StreamIdValidator, token: v.string() },
	returns: v.boolean(),
	handler: async (ctx, { streamId, token }) => {
		const draft = await ctx.db
			.query("drafts")
			.withIndex("by_stream", (q) => q.eq("streamId", streamId))
			.unique();
		if (draft === null || draft.claimed || draft.token !== token) return false;
		await ctx.db.patch(draft._id, { claimed: true });
		return true;
	},
});

export const halt = internalMutation({
	args: { streamId: StreamIdValidator },
	returns: v.null(),
	handler: async (ctx, { streamId }) => {
		await ctx.runMutation(
			components.persistentTextStreaming.lib.setStreamStatus,
			{
				streamId,
				status: "error",
			},
		);
		return null;
	},
});

export const list = query({
	args: { chatId: v.id("chats") },
	returns: v.array(v.object({ stepId: v.string(), text: v.string() })),
	handler: async (ctx, { chatId }) => {
		await requireChat(ctx, chatId);
		const drafts = await ctx.db
			.query("drafts")
			.withIndex("by_chat_step", (q) => q.eq("chatId", chatId))
			.collect();
		const bodies = await Promise.all(
			drafts.map(async ({ stepId, streamId }) => ({
				stepId,
				text: (await streaming.getStreamBody(ctx, streamId as StreamId)).text,
			})),
		);
		return bodies.filter(({ text }) => text !== "");
	},
});

export async function dropDrafts(
	ctx: MutationCtx,
	chatId: Id<"chats">,
	stepIds?: readonly string[],
): Promise<void> {
	const drafts = await ctx.db
		.query("drafts")
		.withIndex("by_chat_step", (q) => q.eq("chatId", chatId))
		.collect();
	for (const draft of drafts) {
		if (stepIds !== undefined && !stepIds.includes(draft.stepId)) continue;
		await streaming.deleteStream(ctx, draft.streamId as StreamId);
		await ctx.db.delete(draft._id);
	}
}

function bearer(request: Request): string | undefined {
	const header = request.headers.get("authorization");
	return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

async function generate(
	ctx: ActionCtx,
	{ streamId, request, config }: ModelCall,
	write: (delta: StreamedDelta) => Promise<boolean>,
): Promise<void> {
	const aborted = new AbortController();
	const upstream = upstreamFor(config);
	const startedAt = Date.now();
	let output = "";
	let usage: ModelUsage | undefined;
	let failure: string | undefined;
	let pending = "";
	const persist = async (final: boolean) => {
		await ctx.runMutation(components.persistentTextStreaming.lib.addChunk, {
			streamId,
			text: pending,
			final,
		});
		pending = "";
	};
	try {
		for await (const delta of streamCompletion(
			upstream,
			request,
			aborted.signal,
		)) {
			if (!(await write(delta))) aborted.abort();
			if (delta.usage !== undefined) usage = delta.usage;
			if (delta.text === undefined) continue;
			output += delta.text;
			pending += delta.text;
			if (endsSentence(delta.text)) await persist(false);
		}
		await persist(true);
	} catch (error) {
		aborted.abort();
		failure = error instanceof Error ? error.message : String(error);
		await ctx.runMutation(internal.drafts.halt, { streamId });
		await write({ failure });
	}
	await traceGeneration(ctx, config, {
		model: upstream.model,
		baseUrl: upstream.baseUrl,
		request,
		output,
		latency: (Date.now() - startedAt) / 1000,
		...(usage === undefined ? {} : { usage }),
		...(failure === undefined ? {} : { failure }),
	});
}

interface Generation {
	readonly model: string;
	readonly baseUrl: string;
	readonly request: ModelRequest;
	readonly output: string;
	readonly latency: number;
	readonly usage?: ModelUsage;
	readonly failure?: string;
}

async function traceGeneration(
	ctx: ActionCtx,
	{ provider, trace }: AgentConfig,
	generation: Generation,
): Promise<void> {
	if (trace === undefined) return;
	const shown = env.POSTHOG_PRIVACY_MODE !== "true";
	await posthog.capture(ctx, {
		distinctId: trace.distinctId ?? trace.threadId,
		event: "$ai_generation",
		properties: {
			$ai_trace_id: trace.threadId,
			$ai_parent_id: trace.turnId,
			thread_id: trace.threadId,
			environment: env.POSTHOG_ENVIRONMENT ?? "local",
			...(trace.sessionId ? { $session_id: trace.sessionId } : {}),
			...(trace.distinctId ? {} : { $process_person_profile: false }),
			$ai_provider: provider ?? trace.provider,
			$ai_model: generation.model,
			$ai_base_url: generation.baseUrl,
			$ai_latency: generation.latency,
			$ai_input_tokens: generation.usage?.input,
			$ai_output_tokens: generation.usage?.output,
			$ai_cache_read_input_tokens: generation.usage?.cachedInput,
			$ai_is_error: generation.failure !== undefined,
			...(generation.failure === undefined
				? {}
				: { $ai_error: generation.failure }),
			...(shown
				? {
						$ai_input: [
							{ role: "system", content: generation.request.system },
							...generation.request.messages,
						],
						$ai_output_choices: [
							{ role: "assistant", content: generation.output },
						],
					}
				: {}),
		},
	});
}

export const streamModel = httpAction(async (ctx, request) => {
	const call = (await request.json()) as ModelCall;
	const token = bearer(request);
	if (
		token === undefined ||
		!(await ctx.runMutation(internal.drafts.claim, {
			streamId: call.streamId,
			token,
		}))
	)
		return new Response(null, { status: 401 });
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();
	let open = true;
	const write = async (delta: StreamedDelta) => {
		if (!open) return false;
		try {
			await writer.write(encodeDelta(delta));
		} catch {
			open = false;
		}
		return open;
	};
	void generate(ctx, call, write).finally(() => writer.close().catch(() => {}));
	return new Response(readable, {
		headers: { "content-type": "application/x-ndjson" },
	});
});
