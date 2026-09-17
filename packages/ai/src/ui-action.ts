import { peekThreadRepl } from "./repl-store.ts";

export interface UiActionResult extends Record<string, unknown> {
	output: string;
	error: boolean;
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
		const { user, annotations, message, failed } = await repl.invokeUi(
			action,
			values,
		);
		return {
			...annotations.output,
			output: user,
			error: failed,
			message,
		};
	} catch (ex) {
		return {
			output: ex instanceof Error ? ex.message : String(ex),
			error: true,
		};
	}
}
