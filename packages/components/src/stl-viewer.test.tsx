// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { StlViewer } from "./stl-viewer.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe("StlViewer", () => {
	it("says so when the browser cannot draw 3D", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		await act(async () => {
			root.render(<StlViewer url="https://example.test/a.stl" name="a.stl" />);
		});
		expect(host.querySelector("[role=status]")?.textContent).toContain(
			"no WebGL",
		);
		await act(async () => {
			root.unmount();
		});
	});
});
