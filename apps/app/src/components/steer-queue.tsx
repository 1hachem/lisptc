import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useChatSession } from "../lib/chat.tsx";
import { UserLine } from "./user-line.tsx";

export function SteerQueue() {
	const { queued, withdraw } = useChatSession((state) => ({
		queued: state.queued,
		withdraw: state.withdraw,
	}));

	return queued.map((item) => (
		<div
			key={item.id}
			className="group relative flex min-w-0 items-start gap-2 text-dim opacity-60"
		>
			<UserLine text={item.text} />
			<button
				type="button"
				aria-label="remove from queue"
				onClick={() => withdraw(item.id)}
				className="mt-[0.3em] flex-none opacity-0 hover:text-fg group-hover:opacity-100"
			>
				<HugeiconsIcon icon={Cancel01Icon} size={12} />
			</button>
		</div>
	));
}
