// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { LoadingGate } from "../src/components/loading-scene.tsx";

vi.mock("@repo/ui", () => ({
	alpineDawn: {},
	AsciiScene: () => <canvas data-scene="" />,
}));

let root: Root | undefined;
let host: HTMLDivElement;

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
	vi.useFakeTimers();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root?.unmount());
	host.remove();
	vi.useRealTimers();
});

function render(loading: boolean) {
	act(() => {
		root?.render(
			<LoadingGate loading={loading}>
				<main>product</main>
			</LoadingGate>,
		);
	});
}

function advance(ms: number) {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

const scene = () => host.querySelector("[data-scene]") !== null;
const product = () => host.querySelector("main") !== null;

describe("LoadingGate", () => {
	it("holds the scene for two seconds when loading ends at once", () => {
		render(false);
		expect(product()).toBe(true);
		expect(scene()).toBe(true);
		advance(1999);
		expect(scene()).toBe(true);
		advance(1);
		expect(scene()).toBe(false);
		expect(product()).toBe(true);
	});

	it("keeps the scene past two seconds while still loading", () => {
		render(true);
		advance(5000);
		expect(scene()).toBe(true);
		expect(product()).toBe(false);
		render(false);
		expect(scene()).toBe(false);
		expect(product()).toBe(true);
	});

	it("drops the scene once both the load and the floor are done", () => {
		render(true);
		advance(800);
		render(false);
		expect(scene()).toBe(true);
		expect(product()).toBe(true);
		advance(1200);
		expect(scene()).toBe(false);
	});
});
