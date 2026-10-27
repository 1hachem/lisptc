import { CATALOGUED_CHOICES, DEFAULT_CHOICE } from "@repo/shared/providers";
import { defaultThemeId, themes } from "@repo/ui/themes";
import type {
	ChatLine,
	ChatPage,
	ChatQuery,
	Settings,
	WorkspaceStore,
} from "@repo/workspace-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import {
	WORKSPACE_ICONS,
	type WorkspaceIcon,
	workspaceIcon,
} from "../convex/lib/workspaceIcons.ts";

export type WorkspaceStoreClient = Pick<ConvexHttpClient, "query" | "mutation">;

function modelName(choice: { provider: string; model: string }): string {
	return `${choice.provider}/${choice.model}`;
}

export const OFFERED_MODELS: readonly string[] =
	CATALOGUED_CHOICES.map(modelName);

function offeredTheme(theme: string | undefined): string {
	return themes.some((offered) => offered.id === theme) && theme !== undefined
		? theme
		: defaultThemeId;
}

function isWorkspaceIcon(icon: string): icon is WorkspaceIcon {
	return (WORKSPACE_ICONS as readonly string[]).includes(icon);
}

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
			icon: workspaceIcon({ _id: this.workspaceId, icon: workspace.icon }),
			theme: offeredTheme(workspace.theme),
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

	async pickIcon(icon: string): Promise<void> {
		if (!isWorkspaceIcon(icon)) throw new Error(`icon not offered: ${icon}`);
		await this.connect().mutation(api.workspaces.setIcon, {
			workspaceId: this.workspaceId,
			icon,
		});
	}

	async pickTheme(theme: string): Promise<void> {
		await this.connect().mutation(api.workspaces.setTheme, {
			workspaceId: this.workspaceId,
			theme,
		});
	}

	async chats(query: ChatQuery): Promise<ChatPage> {
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

	async unarchive(chatId: string): Promise<void> {
		await this.connect().mutation(api.chats.unarchive, {
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
}
