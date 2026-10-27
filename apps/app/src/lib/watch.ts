import { useEffect, useState } from "react";
import { reportIssue } from "./analytics.tsx";
import { apiHeaders } from "./api.ts";
import type { ChatMessage } from "./chat.tsx";

export type ThreadState = "running" | "idle" | "waiting" | "errored";

export interface Watched {
	readonly snapshot: ChatMessage[];
	readonly relayed: readonly ChatMessage[];
	readonly status: ThreadState;
	readonly failure?: string;
}

export const UNWATCHED: Watched = { snapshot: [], relayed: [], status: "idle" };

export interface SseEvent {
	readonly event: string;
	readonly data: unknown;
}

export function readSse(buffer: string): { events: SseEvent[]; rest: string } {
	const blocks = buffer.split("\n\n");
	const rest = blocks.pop() ?? "";
	const events: SseEvent[] = [];
	for (const block of blocks) {
		let event = "message";
		let data = "";
		for (const line of block.split("\n")) {
			if (line.startsWith("event: ")) event = line.slice(7);
			else if (line.startsWith("data: ")) data += line.slice(6);
		}
		if (data !== "") events.push({ event, data: JSON.parse(data) });
	}
	return { events, rest };
}

function withDelta(messages: ChatMessage[], delta: ChatMessage): ChatMessage[] {
	const at = messages.findIndex((message) => message.id === delta.id);
	if (at === -1) return [...messages, delta];
	const standing = messages[at];
	const reasoning = delta.additional_kwargs?.reasoning_content;
	const merged: ChatMessage =
		reasoning === undefined
			? { ...standing, content: `${standing.content}${delta.content}` }
			: {
					...standing,
					additional_kwargs: {
						...standing.additional_kwargs,
						reasoning_content: `${standing.additional_kwargs?.reasoning_content ?? ""}${reasoning}`,
					},
				};
	return messages.map((message, i) => (i === at ? merged : message));
}

export function applyWatched(
	watched: Watched,
	{ event, data }: SseEvent,
): Watched {
	switch (event) {
		case "values":
			return {
				...watched,
				snapshot: (data as { messages: ChatMessage[] }).messages,
			};
		case "messages": {
			const [delta] = data as [ChatMessage];
			return { ...watched, snapshot: withDelta(watched.snapshot, delta) };
		}
		case "relayed":
			return {
				...watched,
				relayed: [...watched.relayed, data as ChatMessage],
			};
		case "status": {
			const { status, failure } = data as {
				status: ThreadState;
				failure?: string;
			};
			return failure === undefined
				? { ...watched, status, failure: undefined }
				: { ...watched, status, failure };
		}
		case "error":
			return { ...watched, failure: (data as { message: string }).message };
		default:
			return watched;
	}
}

export function shownMessages(
	watched: Watched,
	stored: readonly ChatMessage[] = [],
): ChatMessage[] {
	const ids = new Set(watched.snapshot.map((message) => message.id));
	const latest = new Map(stored.map((message) => [message.id, message]));
	return [
		...watched.snapshot,
		...watched.relayed
			.filter((message) => !ids.has(message.id))
			.map((message) => latest.get(message.id) ?? message),
	];
}

const RETRY_MS = 1000;

async function follow(
	chatId: string,
	signal: AbortSignal,
	update: (apply: (watched: Watched) => Watched) => void,
): Promise<void> {
	const response = await fetch(
		`/api/chat/watch?chatId=${encodeURIComponent(chatId)}`,
		{ headers: await apiHeaders(), signal },
	);
	if (!response.ok || response.body === null)
		throw new Error(`the chat could not be watched: ${response.status}`);
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return;
		const { events, rest } = readSse(buffer + value);
		buffer = rest;
		update((watched) => events.reduce(applyWatched, watched));
	}
}

export function useWatch(chatId: string | null): Watched {
	const [watched, setWatched] = useState<Watched>(UNWATCHED);
	useEffect(() => {
		setWatched(UNWATCHED);
		if (chatId === null) return;
		const watching = new AbortController();
		const update = (apply: (watched: Watched) => Watched) => {
			if (!watching.signal.aborted) setWatched(apply);
		};
		void (async () => {
			while (!watching.signal.aborted) {
				try {
					await follow(chatId, watching.signal, update);
				} catch (error) {
					if (watching.signal.aborted) return;
					reportIssue(error, {
						$exception_source: "chat watch",
						thread_id: chatId,
					});
				}
				await new Promise((done) => setTimeout(done, RETRY_MS));
			}
		})();
		return () => watching.abort();
	}, [chatId]);
	return watched;
}
