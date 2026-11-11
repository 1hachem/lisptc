import {
	AIMessage,
	type BaseMessage,
	HumanMessage,
	ChatMessage as RoleMessage,
	SystemMessage,
} from "@langchain/core/messages";
import type { ChatMessage } from "@repo/shared/messages";

export function toLangchain(message: ChatMessage): BaseMessage {
	if (message.role === "system") return new SystemMessage(message.content);
	if (message.role === "developer")
		return new RoleMessage(message.content, "developer");
	if (message.role === "assistant") return new AIMessage(message.content);
	return new HumanMessage(message.content);
}
