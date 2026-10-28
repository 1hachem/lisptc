import type { Awaitable } from "@repo/shared/host";
import type { UiNode } from "./view.ts";

export interface StoredView {
	viewId: string;
	node: UiNode;
}

export interface ViewStore {
	put(view: StoredView): Awaitable<void>;
}

export class MemoryViewStore implements ViewStore {
	readonly views = new Map<string, UiNode>();

	put({ viewId, node }: StoredView): void {
		this.views.set(viewId, node);
	}
}
