import { Typewriter } from "@repo/components";
import { useState } from "react";
import { useChatSession } from "../lib/chat.tsx";
import { usePrefersReducedMotion } from "../lib/motion.ts";

let typedThisVisit = false;

function markTyped() {
	typedThisVisit = true;
}

export function Greeting() {
	const greeting = useChatSession((state) => state.greeting);
	const reduced = usePrefersReducedMotion();
	const [typing] = useState(() => !typedThisVisit);

	return (
		<div className="min-h-[1.7em] min-w-0 break-words text-fg">
			{greeting && (
				<Typewriter
					text={greeting}
					reveal="token"
					enabled={typing && !reduced}
					onDone={markTyped}
				/>
			)}
		</div>
	);
}
