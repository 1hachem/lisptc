// @vitest-environment happy-dom
import { act, type ReactNode, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import {
	FileTree,
	TreeAction,
	TreeCommand,
	TreeFile,
	TreeFolder,
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

	it("offers a command as a button to run, not a link to open", async () => {
		const host = await mounted(
			<TreeCommand name="new_chat" onRun={() => {}} />,
		);
		expect(host.querySelector("a")).toBeNull();
		expect(
			host.querySelector<HTMLButtonElement>('button[title="run new_chat"]'),
		).not.toBeNull();
	});
});

describe("TreePending", () => {
	it("announces the pending upload by name while it runs", async () => {
		const name = "a-very-long-upload-name-that-would-otherwise-wrap.pdf";
		const host = await mounted(
			<TreePending name={name} label="uploading" depth={1} />,
		);
		const row = host.querySelector('[role="status"]');
		expect(row?.getAttribute("aria-label")).toBe(`uploading ${name}`);
		expect(row?.textContent).toBe(name);
	});
});

function selection(props: {
	busy?: boolean;
	failure?: string | null;
	onRun?: () => void;
}): ReactNode {
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
		function Bin() {
			const [gone, setGone] = useState(false);
			return (
				<FileTree>
					<section aria-label="rows">
						{gone ? <p>deleted</p> : selection({ onRun: () => setGone(true) })}
					</section>
				</FileTree>
			);
		}
		const host = await mounted(<Bin />);
		const toolbar = host.querySelector('[role="toolbar"]');
		expect(toolbar?.getAttribute("aria-label")).toBe("1 picked from bin/");
		expect(toolbar?.closest('[aria-label="rows"]')).toBeNull();
		const action = () =>
			[...(toolbar?.querySelectorAll("button") ?? [])].find((each) =>
				["delete", "sure?"].includes(each.textContent ?? ""),
			);
		await act(async () => action()?.click());
		expect(host.textContent).not.toContain("deleted");
		expect(action()?.textContent).toBe("sure?");
		await act(async () => action()?.click());
		expect(host.textContent).toContain("deleted");
	});

	it("offers no action while busy", async () => {
		const host = await mounted(selection({ busy: true }));
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
