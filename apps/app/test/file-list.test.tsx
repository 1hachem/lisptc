// @vitest-environment happy-dom
import { File01Icon } from "@hugeicons/core-free-icons";
import type { Id } from "@repo/backend/dataModel";
import { act, type ReactNode } from "react";
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

const store = vi.hoisted(() => ({
	files: [] as { name: string; addedAt: number }[],
	gone: new Set<string>(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (_ref: unknown, args: { name?: string }) => ({
		queryKey: [args.name],
	}),
	useConvexMutation: () => async () => null,
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: store.files }),
	useQueryClient: () => ({
		fetchQuery: async ({ queryKey: [name] }: { queryKey: [string] }) =>
			store.gone.has(name) ? null : { url: `https://files.test/${name}` },
	}),
}));
vi.mock("../src/components/panel-link.tsx", () => ({
	useShown: () => () => false,
	linkTo: () => (children: ReactNode, className: string) => (
		<a href="/" className={className}>
			{children}
		</a>
	),
}));
vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: () => {} }));

import { AttachmentsFolder } from "../src/components/file-folder.tsx";

let host: HTMLElement;
let root: Root;
const saved: string[] = [];

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

beforeEach(() => {
	saved.length = 0;
	store.gone.clear();
	vi.stubGlobal("fetch", async () => new Response("bytes"));
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:app/1");
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
		this: HTMLAnchorElement,
	) {
		if (this.download) saved.push(this.download);
	});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function folder(names: string[]) {
	store.files = names.map((name, at) => ({
		name,
		addedAt: Date.now() - at * 1000,
	}));
	act(() =>
		root.render(
			<AttachmentsFolder
				workspaceId={"w1" as Id<"workspaces">}
				folder={{
					name: "attachments",
					icon: File01Icon,
					open: true,
					onToggle: () => {},
				}}
			/>,
		),
	);
}

function box(name: string): HTMLInputElement {
	const found = host.querySelector<HTMLInputElement>(
		`input[aria-label="select ${name}"]`,
	);
	if (!found) throw new Error(`no box for ${name}`);
	return found;
}

function tick(name: string, shiftKey = false) {
	act(() => {
		box(name).dispatchEvent(
			new MouseEvent("click", { bubbles: true, shiftKey }),
		);
	});
}

function checked(): string[] {
	return [...host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")]
		.filter((input) => input.checked)
		.map((input) => input.getAttribute("aria-label") ?? "")
		.filter((label) => label.startsWith("select ") && label.includes("."))
		.map((label) => label.slice("select ".length));
}

function search(query: string) {
	const input = host.querySelector<HTMLInputElement>(
		'input[aria-label="search attachments"]',
	);
	if (!input) throw new Error("no search");
	act(() => {
		const set = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set;
		set?.call(input, query);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function press(label: string) {
	const button = [...host.querySelectorAll("button")].find(
		(b) => b.textContent === label,
	);
	if (!button) throw new Error(`no ${label} button`);
	act(() => button.click());
}

const ORDER = ["a.md", "b.md", "c.md", "d.md"];

describe("the attachments folder", () => {
	it("matches a name in any case and lists everything on a blank query", () => {
		folder(["Report.PDF", "notes.md"]);
		search(" report ");
		expect(host.textContent).toContain("Report.PDF");
		expect(host.textContent).not.toContain("notes.md");
		search("  ");
		expect(host.textContent).toContain("notes.md");
	});

	it("checks one file on a plain click and unchecks it on a second", () => {
		folder(ORDER);
		tick("b.md");
		expect(checked()).toEqual(["b.md"]);
		expect(host.textContent).toContain("1 file selected");
		tick("b.md");
		expect(checked()).toEqual([]);
	});

	it("checks every file between the last one checked and a shift-clicked one", () => {
		folder(ORDER);
		tick("d.md");
		tick("b.md", true);
		expect(checked().sort()).toEqual(["b.md", "c.md", "d.md"]);
		expect(host.textContent).toContain("3 files selected");
	});

	it("checks only the shift-clicked file when the last one checked is no longer listed", () => {
		folder(ORDER);
		tick("a.md");
		search("c.md");
		tick("c.md", true);
		search("");
		expect(checked().sort()).toEqual(["a.md", "c.md"]);
	});

	it("checks a whole group, and unchecks it once every file in it is checked", () => {
		folder(ORDER);
		tick("a.md");
		const group = host.querySelector<HTMLInputElement>(
			'input[aria-label="select everything from today"]',
		);
		act(() => group?.click());
		expect(checked().sort()).toEqual(ORDER);
		act(() => group?.click());
		expect(checked()).toEqual([]);
	});

	it("downloads every checked file and names the ones that failed", async () => {
		folder(ORDER);
		store.gone.add("c.md");
		tick("a.md");
		tick("d.md", true);
		press("download");
		await act(async () => {
			await new Promise((settle) => setTimeout(settle, 0));
		});
		expect(saved).toEqual(["a.md", "b.md", "d.md"]);
		expect(host.textContent).toContain("c.md");
	});
});
