import { apiHeaders } from "./api.ts";

export interface UiActionResponse {
	output?: string;
	error?: boolean;
	ui?: unknown;
	message?: string;
	event?: unknown;
}

export type UiActionResult =
	| { readonly live: true; readonly response: UiActionResponse }
	| { readonly live: false };

export async function postUiAction(
	chatId: string | null,
	action: string,
	values: Record<string, string | boolean>,
	messageId?: string,
): Promise<UiActionResult> {
	const res = await fetch("/api/ui-action", {
		method: "POST",
		headers: await apiHeaders(),
		body: JSON.stringify({ chatId, messageId, action, values }),
	});
	if (res.status === 409) return { live: false };
	return { live: true, response: await res.json() };
}
