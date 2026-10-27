import { useCallback, useEffect, useState } from "react";
import { apiHeaders } from "./api.ts";

export interface QueuedMessage {
	id: string;
	text: string;
}

async function steer(
	method: "POST" | "DELETE",
	body: { chatId: string; id: string; message?: string },
): Promise<void> {
	await fetch("/api/chat/steer", {
		method,
		headers: await apiHeaders(),
		body: JSON.stringify(body),
	}).catch(() => undefined);
}

export function useSteerQueue({
	chatId,
	landed,
	streaming,
}: {
	chatId: string | null;
	landed: { id?: string }[];
	streaming: boolean;
}) {
	const [queued, setQueued] = useState<QueuedMessage[]>([]);

	const enqueue = useCallback(
		(text: string) => {
			if (!chatId) return;
			const id = crypto.randomUUID();
			setQueued((q) => [...q, { id, text }]);
			void steer("POST", { chatId, id, message: text });
		},
		[chatId],
	);

	useEffect(() => {
		if (queued.length === 0) return;
		const seen = new Set(landed.map((m) => m.id));
		const waiting = queued.filter((q) => !seen.has(q.id));
		if (!streaming) setQueued([]);
		else if (waiting.length !== queued.length) setQueued(waiting);
	}, [queued, landed, streaming]);

	const withdraw = useCallback(
		(id: string) => {
			setQueued((q) => q.filter((item) => item.id !== id));
			if (chatId) void steer("DELETE", { chatId, id });
		},
		[chatId],
	);

	const clear = useCallback(() => {
		for (const { id } of queued) withdraw(id);
	}, [queued, withdraw]);

	return { queued, enqueue, withdraw, clear };
}
