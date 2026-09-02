/**
 * Notes: a comment written about a conversation while it is in front of you.
 *
 * The point is to capture the moment the agent does something worth acting on —
 * a wrong tool, a missing capability, a good trajectory worth locking in — with
 * no context switch. The note goes to PostHog under the same `$ai_trace_id` as
 * the trace it is about, so the comment and the run it describes are one thing.
 *
 * Posted through the API rather than posthog-js so the project key stays on the
 * server and a note cannot drift into a different PostHog project than the
 * trace it annotates.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const DISTINCT_ID_KEY = "lisptc.distinct-id";

/**
 * A stable per-browser id. Not an account — it exists so one person's traces
 * group together in PostHog, locally today and for real users later, without
 * an auth system having to exist first.
 */
function distinctId(): string | undefined {
	if (typeof localStorage === "undefined") return undefined;
	try {
		const existing = localStorage.getItem(DISTINCT_ID_KEY);
		if (existing) return existing;
		const fresh = crypto.randomUUID();
		localStorage.setItem(DISTINCT_ID_KEY, fresh);
		return fresh;
	} catch {
		// private mode / storage disabled — traces stay anonymous, which is fine
		return undefined;
	}
}

export function apiHeaders(): Record<string, string> {
	const id = distinctId();
	return {
		"content-type": "application/json",
		...(id ? { "x-distinct-id": id } : {}),
	};
}

export interface NoteInput {
	threadId: string;
	text: string;
	target: "conversation" | "message";
	messageId?: string;
	messageIndex?: number;
	messageExcerpt?: string;
}

export interface NoteResult {
	ok: boolean;
	/** false when the server has no PostHog key — the note was accepted and dropped */
	captured: boolean;
	error?: string;
}

// `#tag` anywhere in the note becomes a tag and stays in the text. Tags are how
// a note on one conversation finds the notes on the others that share a cause,
// and typing one inline is the only version of that anyone actually does.
const TAG_RE = /#([a-z0-9][a-z0-9._-]*)/gi;

function extractTags(text: string): string[] {
	return [
		...new Set([...text.matchAll(TAG_RE)].map((m) => m[1].toLowerCase())),
	];
}

export async function postNote(note: NoteInput): Promise<NoteResult> {
	try {
		const res = await fetch(`${API_URL}/api/note`, {
			method: "POST",
			headers: apiHeaders(),
			body: JSON.stringify({ ...note, tags: extractTags(note.text) }),
		});
		if (!res.ok)
			return { ok: false, captured: false, error: `HTTP ${res.status}` };
		const body = (await res.json()) as { captured?: boolean };
		return { ok: true, captured: Boolean(body.captured) };
	} catch (ex) {
		return {
			ok: false,
			captured: false,
			error: ex instanceof Error ? ex.message : String(ex),
		};
	}
}

/** Excerpt of the annotated message, so the note reads on its own in PostHog. */
export function excerpt(text: string, max = 400): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
