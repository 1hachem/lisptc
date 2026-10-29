import { apiHeaders } from "./api.ts";

export interface UiActionResponse {
	output?: string;
	error?: boolean;
	message?: string;
	event?: unknown;
}

export async function postUiAction(
	chatId: string | null,
	action: string,
	values: Record<string, string | boolean>,
	messageId?: string,
): Promise<UiActionResponse> {
	const res = await fetch("/api/ui-action", {
		method: "POST",
		headers: await apiHeaders(),
		body: JSON.stringify({ chatId, messageId, action, values }),
	});
	return await res.json();
}
