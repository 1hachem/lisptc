import type { Id } from "@repo/backend/dataModel";

export const OAUTH_APPROVED_KEY = "lisptc:oauth-approved";

const OAUTH_CHAT_KEY = "lisptc:oauth-chat";

export const OAUTH_CHANNEL = "lisptc:oauth";

export type OAuthSignal =
	| { type: "approved"; state: string }
	| { type: "resuming"; state: string };

export interface AwaitingChat {
	workspaceId: Id<"workspaces">;
	chatId: Id<"chats">;
}

const STATE_PARAM = /[?&]state=([0-9a-f-]{36})/;

export const RESUME_MESSAGE =
	"I approved the authorization. Carry on with what you were doing.";

export interface TranscriptLine {
	type: string;
	text: string;
}

export function callbackState(url: string): string | undefined {
	try {
		return new URL(url).searchParams.get("state") ?? undefined;
	} catch {
		return undefined;
	}
}

export function awaitedState(
	lines: readonly TranscriptLine[],
): string | undefined {
	let awaited: string | undefined;
	for (const line of lines) {
		if (line.type === "human") awaited = undefined;
		else awaited = STATE_PARAM.exec(line.text)?.[1] ?? awaited;
	}
	return awaited;
}

export function rememberAwaitingChat(state: string, chat: AwaitingChat): void {
	try {
		localStorage.setItem(OAUTH_CHAT_KEY, JSON.stringify({ state, ...chat }));
	} catch {}
}

export function awaitingChat(state: string): AwaitingChat | undefined {
	try {
		const saved = JSON.parse(localStorage.getItem(OAUTH_CHAT_KEY) ?? "null") as
			| (Partial<AwaitingChat> & { state?: unknown })
			| null;
		if (saved?.state !== state) return undefined;
		const { workspaceId, chatId } = saved;
		return typeof workspaceId === "string" && typeof chatId === "string"
			? { workspaceId, chatId }
			: undefined;
	} catch {
		return undefined;
	}
}

export function storeApproval(state: string): void {
	try {
		localStorage.setItem(OAUTH_APPROVED_KEY, state);
	} catch {}
}

export function readApproval(): string | null {
	try {
		return localStorage.getItem(OAUTH_APPROVED_KEY);
	} catch {
		return null;
	}
}

export function clearApproval(): void {
	try {
		localStorage.removeItem(OAUTH_APPROVED_KEY);
	} catch {}
}
