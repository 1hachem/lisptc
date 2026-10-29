import type { Awaitable } from "@repo/shared/host";
import type { UiNode } from "./view.ts";

export interface StoredView {
	viewId: string;
	node: UiNode;
}

export interface ViewStore {
	put(view: StoredView): Awaitable<void>;
	expire(viewId: string): Awaitable<void>;
}

export class MemoryViewStore implements ViewStore {
	readonly views = new Map<string, UiNode>();
	readonly expired = new Set<string>();

	put({ viewId, node }: StoredView): void {
		this.views.set(viewId, node);
		this.expired.delete(viewId);
	}

	expire(viewId: string): void {
		if (this.views.has(viewId)) this.expired.add(viewId);
	}
}
