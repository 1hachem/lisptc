// @vitest-environment happy-dom
import { act, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TreeFolder } from "./file-tree.tsx";
import { SortableTree } from "./sortable-list.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

async function mounted(tree: ReactNode) {
	const host = document.createElement("div");
	document.body.append(host);
	await act(async () => {
		createRoot(host).render(<StrictMode>{tree}</StrictMode>);
	});
	return host;
}

describe("SortableTree", () => {
	it("renders every entry in the order it is given", async () => {
		const host = await mounted(
			<SortableTree order={["b", "a", "c"]} onReorder={() => {}}>
				{(id) => <span>{id}</span>}
			</SortableTree>,
		);
		const entries = [...host.querySelectorAll("[data-entry]")];
		expect(entries.map((entry) => entry.textContent)).toEqual(["b", "a", "c"]);
	});

	it("collapses an open folder while it is being dragged", async () => {
		const host = await mounted(
			<SortableTree order={["chat", "memories"]} onReorder={() => {}}>
				{(id) => (
					<TreeFolder name={id} open onToggle={() => {}}>
						<span data-child={id} />
					</TreeFolder>
				)}
			</SortableTree>,
		);
		const chat = host.querySelector<HTMLElement>('[data-entry="chat"]');
		await act(async () => {
			chat?.focus();
			chat?.dispatchEvent(
				new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
			);
		});
		expect(chat?.getAttribute("data-dragging")).toBe("true");
		expect(chat?.querySelector("[data-open]")?.getAttribute("data-open")).toBe(
			"false",
		);
		expect(host.querySelector('[data-child="chat"]')).toBeNull();
		expect(host.querySelector('[data-child="memories"]')).not.toBeNull();
	});

	it("tells which entry was picked up", async () => {
		const onPickUp = vi.fn();
		const host = await mounted(
			<SortableTree
				order={["chat", "memories"]}
				onReorder={() => {}}
				onPickUp={onPickUp}
			>
				{(id) => <span>{id}</span>}
			</SortableTree>,
		);
		const memories = host.querySelector<HTMLElement>('[data-entry="memories"]');
		await act(async () => {
			memories?.focus();
			memories?.dispatchEvent(
				new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
			);
		});
		expect(onPickUp).toHaveBeenCalledWith("memories");
	});
});
