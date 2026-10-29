import type { StoredView, ViewStore } from "@repo/ui-extension";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type ViewClient = Pick<ConvexHttpClient, "mutation">;

export interface ViewClock {
	now(): number;
	after(ms: number, run: () => void): void;
}

const systemClock: ViewClock = {
	now: () => Date.now(),
	after: (ms, run) => {
		setTimeout(run, ms);
	},
};

export const VIEW_WRITE_INTERVAL_MS = 150;

interface Slot {
	written: string | undefined;
	writtenAt: number;
	pending: StoredView | undefined;
	scheduled: boolean;
}

export class ConvexViewStore implements ViewStore {
	private readonly slots = new Map<string, Slot>();

	constructor(
		private readonly chatId: Id<"chats">,
		private readonly connect: () => ViewClient,
		private readonly clock: ViewClock = systemClock,
	) {}

	async put(view: StoredView): Promise<void> {
		const slot = this.slot(view.viewId);
		const json = JSON.stringify(view.node);
		if (json === slot.written) {
			slot.pending = undefined;
			return;
		}
		const wait = slot.writtenAt + VIEW_WRITE_INTERVAL_MS - this.clock.now();
		if (wait <= 0 && !slot.scheduled) {
			await this.write(slot, view, json);
			return;
		}
		slot.pending = view;
		if (slot.scheduled) return;
		slot.scheduled = true;
		this.clock.after(Math.max(wait, 0), () => {
			slot.scheduled = false;
			const next = slot.pending;
			slot.pending = undefined;
			if (next === undefined) return;
			const nextJson = JSON.stringify(next.node);
			if (nextJson === slot.written) return;
			this.write(slot, next, nextJson).catch((ex) => {
				console.error(`[backend] view ${next.viewId} was not written:`, ex);
			});
		});
	}

	async expire(viewId: string): Promise<void> {
		const slot = this.slot(viewId);
		slot.pending = undefined;
		slot.written = undefined;
		slot.writtenAt = Number.NEGATIVE_INFINITY;
		await this.connect().mutation(api.views.expire, {
			chatId: this.chatId,
			viewId,
		});
	}

	private slot(viewId: string): Slot {
		const held = this.slots.get(viewId);
		if (held !== undefined) return held;
		const fresh: Slot = {
			written: undefined,
			writtenAt: Number.NEGATIVE_INFINITY,
			pending: undefined,
			scheduled: false,
		};
		this.slots.set(viewId, fresh);
		return fresh;
	}

	private async write(
		slot: Slot,
		{ viewId, node }: StoredView,
		json: string,
	): Promise<void> {
		slot.written = json;
		slot.writtenAt = this.clock.now();
		try {
			await this.connect().mutation(api.views.put, {
				chatId: this.chatId,
				viewId,
				node,
			});
		} catch (ex) {
			slot.written = undefined;
			throw ex;
		}
	}
}
