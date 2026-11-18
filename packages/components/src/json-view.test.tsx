// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { JsonView } from "./json-view.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	document.body.replaceChildren();
});

async function mounted(text: string) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root?.render(<JsonView text={text} />);
	});
	return host;
}

describe("viewing json", () => {
	it("falls back to the raw text when the json is invalid", async () => {
		const host = await mounted("{oops");
		expect(host.textContent).toContain("not valid json");
		expect(host.querySelector("pre")?.textContent).toBe("{oops");
	});
});
