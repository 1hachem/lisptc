import { Typewriter } from "@repo/ui";
import { useEffect, useState } from "react";
import { pickGreeting } from "../lib/greeting.ts";

/**
 * The agent's opening line, shown while the transcript is empty.
 *
 * Picked in an effect and not in a `useState` initialiser, which is the part
 * worth knowing: the page is server-rendered, and both inputs disagree across
 * that boundary — the die comes up differently, and the server's clock is in the
 * server's timezone. Rendering it during the first pass would either tear at
 * hydration or greet a Californian with "good evening". So the first paint has no
 * greeting and the line lands a frame later, which nobody can see.
 *
 * It then arrives token by token — a word at a time, long words in pieces, on an
 * uneven beat — so a line that costs nothing reads like the turn the agent would
 * have taken. Letter by letter would read as a typewriter, which is a different
 * thing pretending to be this one. The reveal is `@repo/ui`'s typewriter, the
 * primitive this UI already owns, and not a second one written here.
 */

/**
 * Someone who asked for less motion gets the line whole.
 *
 * The reveal is decoration: it carries no information the static line doesn't,
 * which is exactly the test for what this query should switch off. Read live
 * rather than once, because the setting can change under a running page.
 */
function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);

	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const read = () => setReduced(query.matches);
		read();
		query.addEventListener("change", read);
		return () => query.removeEventListener("change", read);
	}, []);

	return reduced;
}

export function Greeting() {
	const [line, setLine] = useState<string | null>(null);
	const reduced = usePrefersReducedMotion();

	useEffect(() => {
		setLine(pickGreeting(new Date()));
	}, []);

	if (!line) return null;
	return (
		<div className="min-w-0 break-words text-fg">
			<Typewriter text={line} reveal="token" enabled={!reduced} />
		</div>
	);
}
