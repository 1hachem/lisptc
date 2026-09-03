import { Typewriter } from "@repo/ui";
import { useChatSession } from "../lib/chat.tsx";
import { usePrefersReducedMotion } from "../lib/motion.ts";

/**
 * The agent's opening line: a real assistant turn (it is `messages[0]`, and it is
 * replayed to the model — see `chat.tsx`) that stays in the transcript once the
 * conversation fills up. This only draws it, which is why it is drawn here and
 * not by the message loop: it is the one turn that arrives typed out rather than
 * streamed.
 *
 * The line is `null` for the first paint, because the session picks it in an
 * effect — the page is server-rendered and both of its inputs disagree across
 * that boundary. So the row lands a frame later, which nobody can see.
 *
 * It then arrives token by token — a word at a time, long words in pieces, on an
 * uneven beat — so a line that costs nothing reads like the turn the agent would
 * have taken. Letter by letter would read as a typewriter, which is a different
 * thing pretending to be this one. The reveal is `@repo/ui`'s typewriter, the
 * primitive this UI already owns, and not a second one written here.
 */

export function Greeting() {
	const { greeting } = useChatSession();
	const reduced = usePrefersReducedMotion();

	/*
	 * The row is HERE from the very first paint, empty, one line tall.
	 *
	 * Without that, nothing at all was rendered until the effect had run, and the
	 * avatar — which sits a fixed line below whatever the last turn is — sat at the
	 * top of an empty column and then jumped a line down when the greeting
	 * appeared. `1.7em` is the shell's own line height (13px at 1.7), so the box
	 * the text lands in is exactly the box that was already standing there, on the
	 * server's paint as much as the browser's.
	 */
	return (
		<div className="min-h-[1.7em] min-w-0 break-words text-fg">
			{greeting && (
				<Typewriter text={greeting} reveal="token" enabled={!reduced} />
			)}
		</div>
	);
}
