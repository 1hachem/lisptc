import { CATALOGUED_CHOICES, DEFAULT_CHOICE } from "@repo/shared/providers";
import type {
	ChatLine,
	ChatPage,
	Settings,
	WorkspaceStore,
} from "@repo/workspace-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type WorkspaceStoreClient = Pick<ConvexHttpClient, "query" | "mutation">;

function modelName(choice: { provider: string; model: string }): string {
	return `${choice.provider}/${choice.model}`;
}

export const OFFERED_MODELS: readonly string[] =
	CATALOGUED_CHOICES.map(modelName);

export class ConvexWorkspaceStore implements WorkspaceStore {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => WorkspaceStoreClient,
	) {}

	async settings(): Promise<Settings> {
		const workspace = await this.connect().query(api.workspaces.get, {
			workspaceId: this.workspaceId,
		});
		return {
			name: workspace.name,
			model: modelName(workspace.model ?? DEFAULT_CHOICE),
		};
	}

	async rename(name: string): Promise<void> {
		await this.connect().mutation(api.workspaces.rename, {
			workspaceId: this.workspaceId,
			name,
		});
	}

	async choose(model: string): Promise<void> {
		const choice = CATALOGUED_CHOICES.find((c) => modelName(c) === model);
		if (choice === undefined) throw new Error(`model not offered: ${model}`);
		await this.connect().mutation(api.workspaces.setModel, {
			workspaceId: this.workspaceId,
			model: choice,
		});
	}

	async chats(query: { search?: string; limit: number }): Promise<ChatPage> {
		const page = await this.connect().query(api.chats.list, {
			workspaceId: this.workspaceId,
			...query,
		});
		return {
			chats: page.chats.map((chat) => ({
				id: chat._id,
				title: chat.title,
				active: chat.lastMessageAt,
			})),
			more: page.more,
		};
	}

	async retitle(chatId: string, title: string): Promise<void> {
		await this.connect().mutation(api.chats.rename, {
			chatId: chatId as Id<"chats">,
			title,
		});
	}

	async archive(chatId: string): Promise<void> {
		await this.connect().mutation(api.chats.archive, {
			chatId: chatId as Id<"chats">,
		});
	}

	async transcript(chatId: string): Promise<ChatLine[]> {
		const messages = await this.connect().query(api.messages.transcript, {
			chatId: chatId as Id<"chats">,
		});
		return messages.map((message) => ({
			role: message.type,
			text: message.content,
		}));
	}

	async files(): Promise<string[]> {
		return await this.connect().query(api.files.list, {
			workspaceId: this.workspaceId,
		});
	}

	async file(path: string): Promise<string | undefined> {
		const source = await this.connect().query(api.files.get, {
			workspaceId: this.workspaceId,
			path,
		});
		return source ?? undefined;
	}

	async write(path: string, source: string): Promise<void> {
		await this.connect().mutation(api.files.put, {
			workspaceId: this.workspaceId,
			path,
			source,
		});
	}

	async remove(path: string): Promise<void> {
		const removed = await this.connect().mutation(api.files.remove, {
			workspaceId: this.workspaceId,
			path,
		});
		if (!removed) throw new Error(`no file ${path}`);
	}
}
