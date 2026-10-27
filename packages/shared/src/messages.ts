import { z } from "zod";

export type Role = "system" | "user" | "assistant";

export const ROLES: Role[] = ["system", "user", "assistant"];

export interface ChatMessage {
	role: Role;
	content: string;
}

export function isRole(name: string): name is Role {
	return (ROLES as string[]).includes(name);
}

export function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			const text = (part as { text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.join("");
}

function lenient<T extends z.ZodType>(schema: T) {
	return schema.optional().catch(undefined);
}

const stepMeta = z.object({
	at: z.string(),
	durationMs: z.number(),
	provider: z.string(),
	model: z.string(),
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	cachedInputTokens: z.number().optional(),
	steps: z.number().optional(),
});

export type StepMeta = z.infer<typeof stepMeta>;

const messageMeta = z
	.object({
		at: lenient(z.string()),
		durationMs: lenient(z.number()),
		provider: lenient(z.string()),
		model: lenient(z.string()),
		inputTokens: lenient(z.number()),
		outputTokens: lenient(z.number()),
		cachedInputTokens: lenient(z.number()),
		steps: lenient(z.number()),
	})
	.catchall(z.unknown());

export type MessageMeta = z.infer<typeof messageMeta>;

const skipped = z.object({
	span: z.tuple([z.number(), z.number()]),
	reason: z.string(),
});

export const messageEnvelope = z.object({
	display: lenient(z.string()),
	failed: lenient(z.literal(true)),
	riding: lenient(z.string()),
	results: lenient(z.array(z.string())),
	reasoning_content: lenient(z.string()),
	prose: lenient(z.array(skipped)),
	meta: lenient(messageMeta),
	source: lenient(z.string()),
	quiet: lenient(z.literal(true)),
	thread: lenient(z.string()),
	asked: lenient(z.string()),
});

export type MessageEnvelope = z.infer<typeof messageEnvelope>;

export const ENVELOPE_KEYS = messageEnvelope.keyof().options;

export type MessageKwargs = MessageEnvelope & Record<string, unknown>;

export function envelopeOf(
	kwargs: Record<string, unknown> | undefined,
): MessageEnvelope {
	return messageEnvelope.parse(kwargs ?? {});
}
