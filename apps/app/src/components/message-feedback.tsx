import type { ExpressionId } from "@repo/bloub";
import type { Thumb } from "@repo/shared/feedback";
import { MessageFeedback as Feedback } from "@repo/ui/components/message-feedback.tsx";
import { useAgent } from "../lib/agent.tsx";
import { captureFeedback } from "../lib/analytics.tsx";
import { useChatSession } from "../lib/chat.tsx";

const FACE: Record<Thumb, ExpressionId> = { up: "heureux", down: "triste" };

export function MessageFeedback({
	messageId,
	index,
}: {
	messageId?: string;
	index: number;
}) {
	const { threadId } = useChatSession();
	const { say } = useAgent();

	return (
		<Feedback
			capture={(properties) =>
				captureFeedback({
					...properties,
					$ai_trace_id: threadId,
					...(messageId ? { message_id: messageId } : {}),
					message_index: index,
				})
			}
			className="absolute top-0 left-full ml-3"
			onRate={(thumb) => say({ face: FACE[thumb] })}
		/>
	);
}
