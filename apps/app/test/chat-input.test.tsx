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
import { ChatInput } from "../src/components/chat-input.tsx";

vi.mock("../src/lib/commands.ts", () => ({
	commands: [{ name: "/clear", desc: "start a fresh session" }],
}));

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

function render(onSubmit: (text: string) => void): HTMLTextAreaElement {
	act(() => root.render(<ChatInput onSubmit={onSubmit} />));
	const area = host.querySelector("textarea");
	if (!area) throw new Error("no textarea");
	return area;
}

function type(area: HTMLTextAreaElement, text: string) {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	act(() => {
		setter?.call(area, text);
		area.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function enter(area: HTMLTextAreaElement, isComposing: boolean) {
	act(() => {
		area.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
				isComposing,
			}),
		);
	});
}

describe("the chat input", () => {
	it("sends on Enter", () => {
		const onSubmit = vi.fn();
		const area = render(onSubmit);
		type(area, "hello (+ 1 2)");
		enter(area, false);
		expect(onSubmit).toHaveBeenCalledWith("hello (+ 1 2)");
	});

	it("leaves an Enter that commits an input-method composition alone", () => {
		const onSubmit = vi.fn();
		const area = render(onSubmit);
		type(area, "にほん");
		enter(area, true);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(area.value).toBe("にほん");
	});

	it("keeps a newline while a form is still open", () => {
		const onSubmit = vi.fn();
		const area = render(onSubmit);
		type(area, "(let ((x 1))");
		enter(area, false);
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
