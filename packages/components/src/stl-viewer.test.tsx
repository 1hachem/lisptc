// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { StlViewer, stlGeometry } from "./stl-viewer.tsx";

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

const ASCII_TRIANGLE = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid t
`;

function binaryStl(triangles: number): ArrayBuffer {
	const buffer = new ArrayBuffer(84 + triangles * 50);
	const view = new DataView(buffer);
	view.setUint32(80, triangles, true);
	for (let t = 0; t < triangles; t++) {
		const at = 84 + t * 50;
		const vertices = [0, 0, 0, 1, 0, 0, 0, 1, t];
		vertices.forEach((v, i) => {
			view.setFloat32(at + 12 + i * 4, v, true);
		});
	}
	return buffer;
}

describe("stlGeometry", () => {
	it("reads an ASCII STL into one triangle", () => {
		const bytes = new TextEncoder().encode(ASCII_TRIANGLE).buffer;
		expect(stlGeometry(bytes).getAttribute("position").count).toBe(3);
	});

	it("reads a binary STL, three vertices per triangle", () => {
		expect(stlGeometry(binaryStl(4)).getAttribute("position").count).toBe(12);
	});

	it("refuses an STL with no triangles", () => {
		expect(() => stlGeometry(binaryStl(0))).toThrow("no triangles");
	});
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
