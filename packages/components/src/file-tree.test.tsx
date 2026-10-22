// @vitest-environment happy-dom
import { act, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	FileTree,
	TreeAction,
	TreeCommand,
	TreeFile,
	TreeFilter,
	TreeFolder,
	TreeGroup,
	TreeMore,
	TreePending,
	TreeSelection,
} from "./file-tree.tsx";

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

const anchor = (content: ReactNode, className: string) => (
	<a href="#file" className={className}>
		{content}
	</a>
);

describe("FileTree", () => {
	it("names a folder with a trailing slash and hides its files when closed", async () => {
		const host = await mounted(
			<FileTree>
				<TreeFolder name="chat" open={false} onToggle={() => {}}>
					<TreeFile name="plan-q4" selected={false} link={anchor} />
				</TreeFolder>
			</FileTree>,
		);
		expect(host.textContent).toContain("chat/");
		expect(host.textContent).not.toContain("plan-q4");
	});

	it("shows the files of an open folder and marks the selected one", async () => {
		const host = await mounted(
			<TreeFolder name="chat" open onToggle={() => {}}>
				<TreeFile name="plan-q4" selected link={anchor} />
				<TreeFile name="fix-login" selected={false} link={anchor} />
			</TreeFolder>,
		);
		const selected = host.querySelectorAll('[data-selected="true"]');
		expect(selected).toHaveLength(1);
		expect(selected[0]?.textContent).toBe("plan-q4");
	});

	it("draws a glyph in place of the file icon", async () => {
		const host = await mounted(
			<TreeFile
				name="plan-q4"
				selected={false}
				link={anchor}
				glyph={<span data-glyph />}
			/>,
		);
		expect(host.querySelector("[data-glyph]")).not.toBeNull();
		expect(host.querySelector("svg")).toBeNull();
	});

	it("toggles a folder from its name and creates from its plus", async () => {
		const onToggle = vi.fn();
		const onCreate = vi.fn();
		const host = await mounted(
			<TreeFolder
				name="chat"
				open
				onToggle={onToggle}
				onCreate={onCreate}
				createLabel="new chat"
			/>,
		);
		await act(async () => {
			host.querySelector<HTMLButtonElement>("button")?.click();
			host.querySelector<HTMLButtonElement>('[title="new chat"]')?.click();
		});
		expect(onToggle).toHaveBeenCalledOnce();
		expect(onCreate).toHaveBeenCalledOnce();
	});

	it("disables a plus that has nothing to create yet", async () => {
		const host = await mounted(
			<TreeFolder
				name="tasks"
				open={false}
				onToggle={() => {}}
				onCreate="disabled"
			/>,
		);
		expect(
			host.querySelector<HTMLButtonElement>('[title="new in tasks/"]')
				?.disabled,
		).toBe(true);
	});

	it("runs a command on click instead of opening it", async () => {
		const onRun = vi.fn();
		const host = await mounted(<TreeCommand name="new_chat" onRun={onRun} />);
		await act(async () => {
			host.querySelector<HTMLButtonElement>('[title="run new_chat"]')?.click();
		});
		expect(onRun).toHaveBeenCalledOnce();
		expect(host.querySelector("[data-selected]")).toBeNull();
	});

	it("reports what is typed in a filter and asks for more on click", async () => {
		const onChange = vi.fn();
		const onMore = vi.fn();
		const host = await mounted(
			<>
				<TreeFilter value="" onChange={onChange} label="search chats" />
				<TreeMore onMore={onMore} />
			</>,
		);
		const input = host.querySelector<HTMLInputElement>(
			'[aria-label="search chats"]',
		);
		await act(async () => {
			if (!input) throw new Error("no filter");
			const setValue = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setValue?.call(input, "login");
			input.dispatchEvent(new Event("input", { bubbles: true }));
			host.querySelector<HTMLButtonElement>("button")?.click();
		});
		expect(onChange).toHaveBeenCalledWith("login");
		expect(onMore).toHaveBeenCalledOnce();
	});
});

describe("TreePending", () => {
	it("shows a spinner and keeps a long name on one truncated line", async () => {
		const name = "a-very-long-upload-name-that-would-otherwise-wrap.pdf";
		const host = await mounted(
			<TreePending name={name} label="uploading" depth={1} />,
		);
		const row = host.querySelector('[role="status"]');
		expect(row?.getAttribute("aria-label")).toBe(`uploading ${name}`);
		expect(row?.querySelector("svg")?.getAttribute("class")).toContain(
			"animate-spin",
		);
		const label = row?.querySelector("span");
		expect(label?.textContent).toBe(name);
		expect(label?.className).toContain("truncate");
		expect(label?.className).toContain("whitespace-nowrap");
	});
});

describe("TreeFile check", () => {
	it("marks a checked file and passes a shift-click on as a range", async () => {
		const onCheck = vi.fn();
		const host = await mounted(
			<TreeFile
				name="notes.md"
				selected={false}
				link={anchor}
				check={{ checked: true, selecting: true, onCheck }}
			/>,
		);
		const box = host.querySelector<HTMLInputElement>(
			'[aria-label="select notes.md"]',
		);
		expect(box?.checked).toBe(true);
		expect(host.querySelector('[data-checked="true"]')).not.toBeNull();
		await act(async () => {
			box?.dispatchEvent(
				new MouseEvent("click", { bubbles: true, shiftKey: true }),
			);
		});
		expect(onCheck).toHaveBeenCalledWith(true);
	});
});

describe("TreeGroup check", () => {
	it("checks everything under a date heading at once", async () => {
		const onCheck = vi.fn();
		const host = await mounted(
			<TreeGroup
				label="today"
				check={{ checked: false, selecting: false, onCheck }}
			/>,
		);
		expect(host.textContent).toBe("today");
		const box = host.querySelector<HTMLInputElement>(
			'[aria-label="select everything from today"]',
		);
		await act(async () => box?.click());
		expect(onCheck).toHaveBeenCalledOnce();
	});
});

function selection(props: {
	busy?: boolean;
	failure?: string | null;
	onRun?: () => void;
}) {
	return (
		<TreeSelection
			count={1}
			total={5}
			label="1 picked from bin/"
			summary="1 picked from bin/"
			allLabel="every"
			clearLabel="none"
			onAll={() => {}}
			onClear={() => {}}
			busy={props.busy}
			failure={props.failure}
		>
			<TreeAction
				label="delete"
				confirm="sure?"
				onRun={props.onRun ?? (() => {})}
			/>
		</TreeSelection>
	);
}

describe("TreeSelection", () => {
	it("floats out of the tree and asks once more before a confirmed action runs", async () => {
		const onRun = vi.fn();
		const host = await mounted(
			<FileTree>
				<div data-testid="rows">{selection({ onRun })}</div>
			</FileTree>,
		);
		expect(
			host.querySelector('[data-testid="rows"] [role="toolbar"]'),
		).toBeNull();
		const toolbar = host.querySelector('[role="toolbar"]');
		expect(toolbar?.getAttribute("aria-label")).toBe("1 picked from bin/");
		expect(document.getElementById("tree-selections")).toBeNull();
		const action = () =>
			[...(toolbar?.querySelectorAll("button") ?? [])].find((each) =>
				["delete", "sure?"].includes(each.textContent ?? ""),
			);
		await act(async () => action()?.click());
		expect(onRun).not.toHaveBeenCalled();
		expect(action()?.textContent).toBe("sure?");
		await act(async () => action()?.click());
		expect(onRun).toHaveBeenCalledOnce();
	});

	it("speaks only in the words it is given", async () => {
		const host = await mounted(selection({}));
		const words = [...host.querySelectorAll("button")].map(
			(button) => button.textContent,
		);
		expect(words).toEqual(["every", "none", "delete"]);
		expect(host.textContent).not.toMatch(/selected|all|clear/);
	});

	it("shows a spinner in place of its actions while busy", async () => {
		const host = await mounted(selection({ busy: true }));
		expect(host.querySelector(".animate-spin")).not.toBeNull();
		expect(
			[...host.querySelectorAll("button")].map((button) => button.textContent),
		).toEqual(["every", "none"]);
	});

	it("says what failed where everyone can see it", async () => {
		const host = await mounted(
			selection({ failure: "1 of 2 failed. a: gone" }),
		);
		expect(host.querySelector('[role="alert"]')?.textContent).toBe(
			"1 of 2 failed. a: gone",
		);
	});
});
