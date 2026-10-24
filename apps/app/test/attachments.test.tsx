// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { useAttachments } from "../src/lib/attachments.ts";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

type Hook = ReturnType<typeof useAttachments>;

async function mounted(discarded: string[]) {
	let hook: Hook | undefined;
	function Probe() {
		hook = useAttachments(
			async (file) => file.name,
			(name) => discarded.push(name),
		);
		return null;
	}
	const host = document.createElement("div");
	const root = createRoot(host);
	act(() => root.render(<Probe />));
	await act(async () => {
		hook?.add([new File(["a"], "a.txt"), new File(["b"], "b.txt")]);
	});
	return { hook: () => hook as Hook, unmount: () => act(() => root.unmount()) };
}

describe("attachments left behind", () => {
	it("are discarded when the composer goes away unsent", async () => {
		const discarded: string[] = [];
		const { unmount } = await mounted(discarded);
		unmount();
		expect(discarded.sort()).toEqual(["a.txt", "b.txt"]);
	});

	it("are kept once they were sent", async () => {
		const discarded: string[] = [];
		const { hook, unmount } = await mounted(discarded);
		act(() => hook().clear());
		unmount();
		expect(discarded).toEqual([]);
	});
});
