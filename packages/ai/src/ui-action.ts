import { nodeToJson, type UiValue } from "@repo/interpreter/ui";
import { peekThreadRepl } from "./repl-store.ts";

export interface UiActionResult {
	output: string;
	error: boolean;
	ui?: UiValue;
	message?: string;
}

export async function runUiAction(
	threadId: string,
	action: string,
	values: Record<string, unknown>,
): Promise<UiActionResult | undefined> {
	const repl = peekThreadRepl(threadId);
	if (!repl) return undefined;
	try {
		const { user, ui, message, failed } = await repl.invokeUi(action, values);
		return {
			output: user,
			error: failed,
			ui: ui ? nodeToJson(ui) : undefined,
			message,
		};
	} catch (ex) {
		return {
			output: ex instanceof Error ? ex.message : String(ex),
			error: true,
		};
	}
}
