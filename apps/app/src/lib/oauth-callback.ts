import type { Id } from "@repo/backend/dataModel";
import { type SystemEventTicket, systemEventTicket } from "./system-event.ts";

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

export interface Approval {
	state: string;
	event: SystemEventTicket;
}

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
		if (line.type === "human" || line.type === "system") awaited = undefined;
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

export function storeApproval(approval: Approval): void {
	try {
		localStorage.setItem(OAUTH_APPROVED_KEY, JSON.stringify(approval));
	} catch {}
}

export function parseApproval(raw: string | null): Approval | null {
	try {
		const saved = JSON.parse(raw ?? "null") as {
			state?: unknown;
			event?: unknown;
		} | null;
		const event = systemEventTicket(saved?.event);
		return typeof saved?.state === "string" && event
			? { state: saved.state, event }
			: null;
	} catch {
		return null;
	}
}

export function readApproval(): Approval | null {
	try {
		return parseApproval(localStorage.getItem(OAUTH_APPROVED_KEY));
	} catch {
		return null;
	}
}

export function clearApproval(): void {
	try {
		localStorage.removeItem(OAUTH_APPROVED_KEY);
	} catch {}
}
