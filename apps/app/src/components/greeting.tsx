import { useChatSession } from "../lib/chat.tsx";

export function Greeting() {
	const greeting = useChatSession((state) => state.greeting);
	return (
		<div className="min-h-[1.7em] min-w-0 break-words text-fg">{greeting}</div>
	);
}
