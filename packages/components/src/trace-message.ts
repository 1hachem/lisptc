import type { Entry } from "@repo/shared/journal";
import { envelopeOf, type MessageKwargs } from "@repo/shared/messages";

export interface ChatMessage {
	id?: string;
	type: string;
	content: unknown;
	additional_kwargs?: MessageKwargs;
	entries?: readonly Entry[];
}

export interface StepMeta {
	at?: string;
	durationMs?: number;
	provider?: string;
	model?: string;
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
	steps?: number;
}

function named(value: string | undefined): string | undefined {
	return value === "" ? undefined : value;
}

export function stepMeta(message: ChatMessage): StepMeta | undefined {
	const { meta } = envelopeOf(message.additional_kwargs);
	if (meta === undefined || meta.durationMs === undefined) return undefined;
	return {
		at: meta.at,
		durationMs: meta.durationMs,
		provider: named(meta.provider),
		model: named(meta.model),
		inputTokens: meta.inputTokens,
		outputTokens: meta.outputTokens,
		cachedInputTokens: meta.cachedInputTokens,
		steps: meta.steps,
	};
}

export function isToolMessage(message: ChatMessage): boolean {
	return message.type === "tool";
}

export function isSystemMessage(message: ChatMessage): boolean {
	return message.type === "system";
}

export function isUserMessage(message: ChatMessage): boolean {
	return message.type === "human" || message.type === "user";
}

export function isParentMessage(message: ChatMessage): boolean {
	return (
		isSystemMessage(message) &&
		(envelopeOf(message.additional_kwargs).source?.startsWith("agent:") ??
			false)
	);
}

export function toolModelOutput(message: ChatMessage): {
	output: string;
	error: boolean;
} {
	const text = messageText(message);
	try {
		const parsed = JSON.parse(text) as {
			source?: unknown;
			output?: unknown;
			error?: unknown;
		};
		if (parsed?.source === "lisp-repl")
			return {
				output: String(parsed.output ?? ""),
				error: Boolean(parsed.error),
			};
	} catch {}
	return { output: text, error: false };
}

export function messageText(message: ChatMessage): string {
	const { content } = message;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				typeof part === "string"
					? part
					: part && typeof part === "object" && "text" in part
						? String(part.text)
						: "",
			)
			.join("");
	}
	return "";
}
