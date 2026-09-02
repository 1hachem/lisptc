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
 */
export function Greeting() {
	const [line, setLine] = useState<string | null>(null);

	useEffect(() => {
		setLine(pickGreeting(new Date()));
	}, []);

	if (!line) return null;
	return <div className="min-w-0 break-words text-fg">{line}</div>;
}
