import type { ModelCallOptions, ModelHost } from "@repo/ai";
import type { ModelDelta, ModelRequest } from "@repo/interpreter/session";
import { internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { decodeDeltas, MODEL_ROUTE } from "../convex/lib/deltas.js";
import type { ServerClient } from "./server-client.ts";

export class ConvexModelHost implements ModelHost {
	constructor(
		private readonly server: ServerClient,
		private readonly siteUrl: string,
		private readonly fetcher: typeof fetch = fetch,
	) {}

	async *stream(
		threadId: string,
		request: ModelRequest,
		{ config, stepId, signal }: ModelCallOptions,
	): AsyncGenerator<ModelDelta> {
		const { streamId, token } = await this.server.mutation(
			internal.drafts.open,
			{ chatId: threadId as Id<"chats">, stepId },
		);
		const halt = () => {
			this.server
				.mutation(internal.drafts.halt, { streamId })
				.catch((error) => {
					console.error("[backend] a model stream was not halted:", error);
				});
		};
		signal?.addEventListener("abort", halt, { once: true });
		try {
			const response = await this.fetcher(new URL(MODEL_ROUTE, this.siteUrl), {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ streamId, request, config }),
				signal,
			});
			if (!response.ok || response.body === null)
				throw new Error(`the model stream was refused: ${response.status}`);
			yield* decodeDeltas(response.body);
		} finally {
			signal?.removeEventListener("abort", halt);
		}
	}
}
