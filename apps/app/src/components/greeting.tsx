import { Typewriter } from "@repo/ui";
import { useChatSession } from "../lib/chat.tsx";
import { usePrefersReducedMotion } from "../lib/motion.ts";

export function Greeting() {
	const { greeting } = useChatSession();
	const reduced = usePrefersReducedMotion();

	return (
		<div className="min-h-[1.7em] min-w-0 break-words text-fg">
			{greeting && (
				<Typewriter text={greeting} reveal="token" enabled={!reduced} />
			)}
		</div>
	);
}
