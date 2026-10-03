import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Queue,
	QueueItem,
	QueueItemAction,
	QueueItemActions,
	QueueItemContent,
	QueueList,
} from "@repo/ui";
import { useChatSession } from "../lib/chat.tsx";

export function SteerQueue() {
	const { queued, withdraw } = useChatSession((state) => ({
		queued: state.queued,
		withdraw: state.withdraw,
	}));

	if (queued.length === 0) return null;

	return (
		<Queue className="mx-auto w-full max-w-[680px] rounded-b-none border-b-0 font-mono text-[13px]">
			<QueueList>
				{queued.map((item) => (
					<QueueItem
						key={item.id}
						className="px-2 py-0.5 text-[12px] leading-[1.6]"
					>
						<QueueItemContent className="text-dim">
							{item.text}
						</QueueItemContent>
						<QueueItemActions>
							<QueueItemAction
								aria-label="remove from queue"
								onClick={() => withdraw(item.id)}
							>
								<HugeiconsIcon icon={Cancel01Icon} size={12} />
							</QueueItemAction>
						</QueueItemActions>
					</QueueItem>
				))}
			</QueueList>
		</Queue>
	);
}
