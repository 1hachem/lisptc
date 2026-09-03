import { useEffect, useState } from "react";

/**
 * Someone who asked for less motion gets the text whole.
 *
 * The reveal is decoration: it carries no information the static line doesn't,
 * which is exactly the test for what this query should switch off. Read live
 * rather than once, because the setting can change under a running page.
 *
 * `false` until the first effect runs, which is also what the server has to
 * assume — it cannot know the preference, and the reveal starting a frame late is
 * not something anyone can see.
 */
export function usePrefersReducedMotion(): boolean {
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
