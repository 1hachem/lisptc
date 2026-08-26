import { useCallback, useSyncExternalStore } from "react";

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
}

let messages: ChatMessage[] = [];
const listeners = new Set<() => void>();
let seq = 0;

function emit() {
	for (const l of listeners) l();
}

export function sendMessage(input: string) {
	const text = input.trim();
	if (!text) return;
	messages = [...messages, { id: `m${seq++}`, role: "user", text }];
	emit();
	// TODO: wire to the agent backend and append the assistant reply here.
}

export function clearMessages() {
	messages = [];
	emit();
}

export function useChat() {
	const subscribe = useCallback((cb: () => void) => {
		listeners.add(cb);
		return () => listeners.delete(cb);
	}, []);
	const snapshot = useCallback(() => messages, []);
	return useSyncExternalStore(subscribe, snapshot, snapshot);
}
