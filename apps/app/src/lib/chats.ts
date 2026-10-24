import { NEW_CHAT } from "./panel-ops.ts";
import { requestPanel } from "./panel-requests.ts";

function openNewChat(): void {
	requestPanel(NEW_CHAT);
}

export function useNewChat(): () => void {
	return openNewChat;
}
