import type { Id } from "@repo/backend/dataModel";

export const OAUTH_AUTHORIZED_KEY = "lisptc:oauth-authorized";

const OAUTH_CHAT_KEY = "lisptc:oauth-chat";

export const OAUTH_CHANNEL = "lisptc:oauth";

export type OAuthSignal =
	| { type: "authorized"; state: string }
	| { type: "answering"; state: string };

export interface AwaitingChat {
	workspaceId: Id<"workspaces">;
	chatId: Id<"chats">;
}

export function callbackState(url: string): string | undefined {
	try {
		return new URL(url).searchParams.get("state") ?? undefined;
	} catch {
		return undefined;
	}
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

export function storeAuthorized(state: string): void {
	try {
		localStorage.setItem(OAUTH_AUTHORIZED_KEY, state);
	} catch {}
}

export function readAuthorized(): string | null {
	try {
		return localStorage.getItem(OAUTH_AUTHORIZED_KEY);
	} catch {
		return null;
	}
}

export function clearAuthorized(): void {
	try {
		localStorage.removeItem(OAUTH_AUTHORIZED_KEY);
	} catch {}
}
