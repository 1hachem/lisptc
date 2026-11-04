import type { ExpressionId } from "@repo/bloub";
import { MessageFeedback as Feedback, type Thumb } from "@repo/components";
import { anchorOf } from "@repo/ui-catalog";
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
	const chatId = useChatSession((state) => state.chatId);
	const { say } = useAgent();

	return (
		<Feedback
			anchor={anchorOf("chat/feedback")}
			capture={(properties) =>
				captureFeedback({
					...properties,
					$ai_trace_id: chatId ?? undefined,
					...(messageId ? { message_id: messageId } : {}),
					message_index: index,
				})
			}
			onRate={(thumb) => say({ face: FACE[thumb] })}
		/>
	);
}
