import type { ReplStore } from "./repl-store.ts";

export interface UiActionResult extends Record<string, unknown> {
	output: string;
	error: boolean;
	message?: string;
	annotations?: Record<string, unknown>;
}

export async function runUiAction<Id extends string>(
	repls: ReplStore<Id>,
	threadId: Id,
	action: string,
	values: Record<string, unknown>,
): Promise<UiActionResult> {
	const repl = await repls.get(threadId);
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
			annotations: annotations.output,
		};
	} catch (ex) {
		return {
			output: ex instanceof Error ? ex.message : String(ex),
			error: true,
		};
	}
}
