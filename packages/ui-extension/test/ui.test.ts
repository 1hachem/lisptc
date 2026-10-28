import { bufferTransport } from "@repo/interpreter/channels-host";
import { Interp, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { TAGS, widgetOf } from "@repo/ui-catalog";
import { describe, expect, it } from "vitest";
import {
	fileTab,
	joinMessages,
	nodeToJson,
	type PanelOp,
	type PanelStore,
	type PanelTab,
	rendered,
	sent,
	type UiNode,
	UiSurface,
	type UiValue,
	uiExtension,
	viewTab,
} from "../src/ui.ts";
import { uiHostFor } from "../src/ui-host.ts";
import { WIDGET_FORMS } from "../src/widgets.ts";

function panelOf(saved: PanelTab[]): { panel: PanelStore; ops: PanelOp[] } {
	let tabs = [...saved];
	const ops: PanelOp[] = [];
	const without = (id: string) => tabs.filter((tab) => tab.id !== id);
	const panel: PanelStore = {
		apply(applied) {
			ops.push(...applied);
			for (const op of applied) {
				if (op.op === "close") tabs = without(op.tab);
				if (op.op === "open")
					tabs = [
						...without(op.tab).map((tab) => ({ ...tab, focused: false })),
						{
							id: op.tab,
							kind: op.content.kind,
							title:
								op.content.kind === "view" ? op.content.title : op.content.name,
							shown: true,
							focused: true,
						},
					];
			}
		},
		tabs: () => tabs,
	};
	return { panel, ops };
}

function collector(interp: Interp) {
	let view: UiNode | undefined;
	let messages: string[] = [];
	rendered.on(interp.channels, (node) => {
		view = node;
	});
	sent.on(interp.channels, (text) => {
		messages.push(text);
	});
	return {
		takeView(): UiNode | undefined {
			const v = view;
			view = undefined;
			return v;
		},
		takeMessage(): string | undefined {
			const m = joinMessages(messages);
			messages = [];
			return m;
		},
	};
}

function fresh(): {
	interp: Interp;
	surface: UiSurface;
	ui: ReturnType<typeof collector>;
	ops: PanelOp[];
} {
	const surface = new UiSurface();
	const { panel, ops } = panelOf([]);
	const host = uiHostFor({ panel });
	const interp = new Interp({ extensions: [uiExtension(host, { surface })] });
	runSync(interp, prelude);
	return { interp, surface, ui: collector(interp), ops };
}

function render(code: string): {
	view: UiValue | undefined;
	surface: UiSurface;
	interp: Interp;
	ui: ReturnType<typeof collector>;
} {
	const { interp, surface, ui } = fresh();
	runSync(interp, code);
	const node = ui.takeView();
	return { view: node ? nodeToJson(node) : undefined, surface, interp, ui };
}

describe("building a view", () => {
	it("renders nothing until ui/render is called", () => {
		const { interp, ui } = fresh();
		runSync(interp, '(ui/stack (ui/text "hi"))');
		expect(ui.takeView()).toBeUndefined();
	});

	it("serialises a tree of tags, props and children", () => {
		const { view } = render(
			'(ui/render (ui/stack (ui/heading "Issues") (ui/text "two open")))',
		);
		expect(view).toEqual({
			tag: "stack",
			props: {},
			children: [
				{ tag: "heading", props: { text: "Issues" }, children: [] },
				{ tag: "text", props: { text: "two open" }, children: [] },
			],
		});
	});

	it("lifts a bare string child into ui/text", () => {
		const { view } = render('(ui/render (ui/row "a" "b"))');
		expect(view).toMatchObject({
			children: [{ tag: "text" }, { tag: "text" }],
		});
	});

	it("reports only a one-line summary of what it drew", () => {
		const { interp } = fresh();
		expect(
			str(
				runSync(
					interp,
					'(ui/render (ui/row (ui/button "a" (lambda () nil)) (ui/button "b" (lambda () nil))))',
				),
			),
		).toBe('"rendered row, 3 elements, 2 actions"');
	});

	it("takeView reads and clears, so a later step does not redraw it", () => {
		const { interp, ui } = fresh();
		runSync(interp, '(ui/render (ui/text "once"))');
		expect(ui.takeView()).toBeDefined();
		expect(ui.takeView()).toBeUndefined();
	});

	it("refuses to render anything that is not a widget", () => {
		const { interp } = fresh();
		expect(() => runSync(interp, '(ui/render "just text")')).toThrow(
			/ui element expected/,
		);
	});
});

describe("echoing a widget", () => {
	function echoed(code: string) {
		const { interp, ui } = fresh();
		const buffer = bufferTransport();
		const detach = interp.channels.pipe(buffer);
		try {
			const result = runSync(interp, code);
			const view = ui.takeView();
			return {
				result,
				view: view ? nodeToJson(view) : undefined,
				text: buffer.collectText("user"),
			};
		} finally {
			detach();
		}
	}

	it("renders a lone widget as ui/render would, printing nothing", () => {
		const { result, view, text } = echoed(`(echo (ui/table '((("id" . 1)))))`);
		expect(view).toMatchObject({ tag: "table" });
		expect(text).toBe("");
		expect(str(result)).toBe('"rendered table, 1 element, 0 actions"');
	});

	it("stacks the other arguments around the widget, in order", () => {
		const { view } = echoed('(echo "Issues:" (ui/text "two") 3)');
		expect(view).toEqual({
			tag: "stack",
			props: {},
			children: [
				{ tag: "text", props: { text: "Issues:" }, children: [] },
				{ tag: "text", props: { text: "two" }, children: [] },
				{ tag: "text", props: { text: "3" }, children: [] },
			],
		});
	});

	it("still prints when no argument is a widget", () => {
		const { view, text } = echoed('(echo "plain" 1)');
		expect(view).toBeUndefined();
		expect(text).toBe("plain 1\n");
	});
});

describe("tables", () => {
	const ROWS =
		'(setq rows (list (list (cons "id" "1") (cons "title" "a")) (list (cons "id" "2") (cons "title" "b"))))';

	it("takes columns from the first row when none are named", () => {
		const { view } = render(`${ROWS} (ui/render (ui/table rows))`);
		expect(view).toMatchObject({
			tag: "table",
			props: {
				columns: ["id", "title"],
				rows: [
					{ id: "1", title: "a" },
					{ id: "2", title: "b" },
				],
			},
		});
	});

	it("keeps only the named columns, in the order given", () => {
		const { view } = render(
			`${ROWS} (ui/render (ui/table rows :columns '("title")))`,
		);
		expect(view).toMatchObject({ props: { columns: ["title"] } });
	});
});

describe("the display widgets", () => {
	it("serialises a link as text and href", () => {
		const { view } = render(
			'(ui/render (ui/link "PR 12" "https://example.com/12"))',
		);
		expect(view).toEqual({
			tag: "link",
			props: { text: "PR 12", href: "https://example.com/12" },
			children: [],
		});
	});

	it("serialises a file link as text, folder and name, inside a stack", () => {
		const { view } = render(
			'(ui/render (ui/stack (ui/file-link "Q3" "knowledge" "q3.pdf")))',
		);
		expect(view).toEqual({
			tag: "stack",
			props: {},
			children: [
				{
					tag: "file-link",
					props: { text: "Q3", folder: "knowledge", name: "q3.pdf" },
					children: [],
				},
			],
		});
	});

	it("rejects a file link to a folder the app does not have", () => {
		const { interp } = fresh();
		expect(() =>
			runSync(interp, '(ui/file-link "x" "downloads" "x.txt")'),
		).toThrow(/unknown folder/);
	});

	it("carries a badge's tone only when one was given", () => {
		expect(
			render('(ui/render (ui/badge "open" :tone "ok"))').view,
		).toMatchObject({ tag: "badge", props: { text: "open", tone: "ok" } });
		expect(render('(ui/render (ui/badge "open"))').view).toEqual({
			tag: "badge",
			props: { text: "open" },
			children: [],
		});
	});

	it("rejects a tone the frontend cannot draw", () => {
		const { interp } = fresh();
		expect(() =>
			runSync(interp, '(ui/badge "open" :tone "chartreuse")'),
		).toThrow(/unknown tone/);
	});

	it("renders a kpi's value as text, whatever it was", () => {
		const { view } = render('(ui/render (ui/kpi "open" (+ 20 7)))');
		expect(view).toEqual({
			tag: "kpi",
			props: { label: "open", value: "27" },
			children: [],
		});
	});

	it("carries a kpi's hint only when one was given", () => {
		expect(
			render('(ui/render (ui/kpi "open" "27" :hint "was 31"))').view,
		).toMatchObject({ props: { hint: "was 31" } });
	});

	it("nests children under a card's title", () => {
		const { view } = render(
			'(ui/render (ui/card "Issues" (ui/text "two open")))',
		);
		expect(view).toMatchObject({
			tag: "card",
			props: { title: "Issues" },
			children: [{ tag: "text", props: { text: "two open" } }],
		});
	});

	it("prints a non-string ui/text the way echo would", () => {
		expect(render("(ui/render (ui/text 42))").view).toEqual({
			tag: "text",
			props: { text: "42" },
			children: [],
		});
	});

	it("serialises a heading and markdown as their text", () => {
		expect(render('(ui/render (ui/heading "Issues"))').view).toEqual({
			tag: "heading",
			props: { text: "Issues" },
			children: [],
		});
		expect(render('(ui/render (ui/markdown "**two**"))').view).toEqual({
			tag: "markdown",
			props: { text: "**two**" },
			children: [],
		});
	});

	it("accepts a link and a kpi by name, in any order", () => {
		expect(
			render('(ui/render (ui/link :url "https://x.dev" :text "x"))').view,
		).toEqual({
			tag: "link",
			props: { text: "x", href: "https://x.dev" },
			children: [],
		});
		expect(render('(ui/render (ui/kpi :value 27 :label "open"))').view).toEqual(
			{
				tag: "kpi",
				props: { label: "open", value: "27" },
				children: [],
			},
		);
	});

	it("carries only the input options that were given", () => {
		expect(render('(ui/render (ui/input :name "q"))').view).toEqual({
			tag: "input",
			props: { name: "q" },
			children: [],
		});
		expect(
			render(
				'(ui/render (ui/input :name "q" :label "Search" :placeholder "…" :value "x"))',
			).view,
		).toEqual({
			tag: "input",
			props: { name: "q", label: "Search", placeholder: "…", value: "x" },
			children: [],
		});
	});

	it("prints every select option as a string", () => {
		expect(
			render(
				'(ui/render (ui/select \'("a" 2) :name "s" :label "Pick" :value "a"))',
			).view,
		).toEqual({
			tag: "select",
			props: { name: "s", options: ["a", "2"], label: "Pick", value: "a" },
			children: [],
		});
	});

	it("needs a :name on an input and a select", () => {
		const { interp } = fresh();
		expect(() => runSync(interp, "(ui/input)")).toThrow(
			/ui\/input needs a :name/,
		);
		expect(() => runSync(interp, '(ui/select \'("a"))')).toThrow(
			/ui\/select needs a :name/,
		);
	});

	it("nests a form's fields and carries its submit label", () => {
		const { view } = render(
			'(ui/render (ui/form (lambda (v) v) (ui/input :name "q") :submit "Go"))',
		);
		expect(view).toEqual({
			tag: "form",
			props: { action: "a1", submit: "Go" },
			children: [{ tag: "input", props: { name: "q" }, children: [] }],
		});
	});

	it("needs a :name on a checkbox, as on every other field", () => {
		const { interp } = fresh();
		expect(() => runSync(interp, "(ui/checkbox)")).toThrow(
			/ui\/checkbox needs a :name/,
		);
	});

	it("reads :checked with lisp truthiness", () => {
		expect(
			render('(ui/render (ui/checkbox :name "o" :checked t))').view,
		).toMatchObject({ props: { name: "o", checked: true } });
		expect(
			render('(ui/render (ui/checkbox :name "o" :checked nil))').view,
		).toMatchObject({ props: { checked: false } });
		expect(render('(ui/render (ui/checkbox :name "o"))').view).toEqual({
			tag: "checkbox",
			props: { name: "o" },
			children: [],
		});
	});
});

describe("actions", () => {
	it("serialises a handler as an opaque id, never as code", () => {
		const { view } = render(
			'(ui/render (ui/button "go" (lambda () (ui/render (ui/text "went")))))',
		);
		expect(view).toMatchObject({
			tag: "button",
			props: { label: "go", action: "a1" },
		});
	});

	it("rejects a non-callable action where the mistake was made", () => {
		const { interp } = fresh();
		expect(() => runSync(interp, '(ui/button "go" "not a function")')).toThrow(
			/function expected as a ui action/,
		);
	});

	it("runs the handler against the live session", async () => {
		const { surface, interp } = render(`
			(setq clicks 0)
			(ui/render (ui/button "+1" (lambda () (setq clicks (+ clicks 1)) (ui/render (ui/text "ok")))))
		`);
		await surface.invoke("a1", {});
		await surface.invoke("a1", {});
		expect(str(runSync(interp, "(identity clicks)"))).toBe("2");
	});

	it("hands a handler that takes an argument the submitted fields", async () => {
		const { surface, interp } = render(`
			(ui/render (ui/form (lambda (values) (setq seen (cdr (assoc "q" values))))
				(ui/input :name "q")))
		`);
		await surface.invoke("a1", { q: "auth" });
		expect(str(runSync(interp, "(identity seen)"))).toBe('"auth"');
	});

	it("calls a zero-argument handler with no arguments", async () => {
		const { surface, interp } = render(`
			(setq hits 0)
			(ui/render (ui/button "go" (lambda () (setq hits (+ hits 1)))))
		`);
		await surface.invoke("a1", { q: "ignored" });
		expect(str(runSync(interp, "(identity hits)"))).toBe("1");
	});

	it("replaces the view with whatever the handler rendered", async () => {
		const { surface, ui } = render(`
			(setq n 0)
			(defun panel () (ui/stack (ui/text (string n))
				(ui/button "+1" (lambda () (setq n (+ n 1)) (ui/render (panel))))))
			(ui/render (panel))
		`);
		await surface.invoke("a1", {});
		expect(nodeToJson(ui.takeView() as never)).toMatchObject({
			children: [{ tag: "text", props: { text: "1" } }, { tag: "button" }],
		});
	});

	it("forgets the handlers behind a view's controls", async () => {
		const { surface, interp } = render(`
			(setq view (ui/stack (ui/button "a" (lambda () 1)) (ui/checkbox :name "b" :on-change (lambda (v) v))))
			(ui/render view)
		`);
		expect(str(runSync(interp, "(ui/forget view)"))).toBe("2");
		await expect(surface.invoke("a1", {})).rejects.toThrow(/no such ui action/);
		expect(str(runSync(interp, "(ui/forget view)"))).toBe("0");
	});

	it("reports an id it does not know rather than doing nothing", async () => {
		const { surface } = render('(ui/render (ui/text "hi"))');
		await expect(surface.invoke("a99", {})).rejects.toThrow(
			/no such ui action/,
		);
	});

	it("registers an :on-change as an action, like a button's", () => {
		const { view } = render(`
			(ui/render (ui/select '("7" "30") :name "d"
				:on-change (lambda (values) (ui/render (ui/text (cdr (assoc "d" values)))))))
		`);
		expect(view).toMatchObject({
			tag: "select",
			props: { name: "d", options: ["7", "30"], "on-change": "a1" },
		});
	});

	it("runs an :on-change against the live session", async () => {
		const { surface, ui } = render(`
			(ui/render (ui/select '("7" "30") :name "d"
				:on-change (lambda (values) (ui/render (ui/text (cdr (assoc "d" values)))))))
		`);
		await surface.invoke("a1", { d: "30" });
		expect(nodeToJson(ui.takeView() as never)).toMatchObject({
			props: { text: "30" },
		});
	});

	it("hands a checkbox's value over as a boolean a handler can test", async () => {
		const { surface, interp } = render(`
			(ui/render (ui/form (lambda (values)
				(setq seen (if (cdr (assoc "open" values)) "on" "off")))
				(ui/checkbox :name "open")))
		`);
		await surface.invoke("a1", { open: true });
		expect(str(runSync(interp, "(identity seen)"))).toBe('"on"');
		await surface.invoke("a1", { open: false });
		expect(str(runSync(interp, "(identity seen)"))).toBe('"off"');
	});

	it("counts an :on-change in the render summary", () => {
		const { interp } = fresh();
		expect(
			str(
				runSync(
					interp,
					`(ui/render (ui/row (ui/button "go" (lambda () nil))
						(ui/checkbox :name "o" :on-change (lambda (v) nil))))`,
				),
			),
		).toBe('"rendered row, 3 elements, 2 actions"');
	});

	it("lets a handler echo", async () => {
		const { surface, interp } = render(
			'(ui/render (ui/button "say" (lambda () (echo "from the click"))))',
		);
		const buffer = bufferTransport();
		const detach = interp.channels.pipe(buffer);
		try {
			await surface.invoke("a1", {});
		} finally {
			detach();
		}
		expect(buffer.collectText("user")).toBe("from the click\n");
	});
});

describe("handing a turn back to the agent", () => {
	it("carries a handler's message out, joining the arguments like echo", async () => {
		const { surface, ui } = render(`
			(ui/render (ui/form (lambda (values) (ui/send "search for" (cdr (assoc "q" values))))
				(ui/input :name "q")))
		`);
		await surface.invoke("a1", { q: "auth" });
		expect(ui.takeMessage()).toBe("search for auth");
	});

	it("reads and clears, so a message is delivered once", async () => {
		const { surface, ui } = render(
			'(ui/render (ui/button "go" (lambda () (ui/send "go"))))',
		);
		await surface.invoke("a1", {});
		expect(ui.takeMessage()).toBe("go");
		expect(ui.takeMessage()).toBeUndefined();
	});

	it("joins several sends in a handler into a single message", async () => {
		const { surface, ui } = render(
			'(ui/render (ui/button "go" (lambda () (ui/send "first") (ui/send "second"))))',
		);
		await surface.invoke("a1", {});
		expect(ui.takeMessage()).toBe("first\n\nsecond");
	});

	it("lets a handler render and send in the same click", async () => {
		const { surface, ui } = render(`
			(ui/render (ui/button "go" (lambda () (ui/render (ui/text "working…")) (ui/send "do it"))))
		`);
		await surface.invoke("a1", {});
		expect(nodeToJson(ui.takeView() as never)).toMatchObject({
			props: { text: "working…" },
		});
		expect(ui.takeMessage()).toBe("do it");
	});

	it("caps a message rather than letting a handler post an essay", async () => {
		const { surface, ui } = render(`
			(defun wide (n) (let ((s "")) (dotimes (i n) (setq s (concat s "abcdefghij"))) s))
			(ui/render (ui/button "go" (lambda () (ui/send (wide 600)))))
		`);
		await surface.invoke("a1", {});
		const message = ui.takeMessage() ?? "";
		expect(message.length).toBeLessThan(4100);
		expect(message).toMatch(/message truncated/);
	});

	it("reports no message for a click that sent nothing", async () => {
		const { surface, ui } = render(
			'(ui/render (ui/button "go" (lambda () (ui/render (ui/text "x")))))',
		);
		await surface.invoke("a1", {});
		expect(ui.takeMessage()).toBeUndefined();
	});
});

describe("the panel beside the chat", () => {
	function opened(code: string) {
		const { interp, ops } = fresh();
		const result = runSync(interp, code);
		return { ops, result };
	}

	it("opens a file in the focused split by default and returns its tab id", () => {
		const { ops, result } = opened('(ui/open-file "attachments" "cat.png")');
		expect(result).toBe(fileTab("attachments", "cat.png"));
		expect(ops).toEqual([
			{
				op: "open",
				tab: "file:attachments/cat.png",
				split: "here",
				content: { kind: "file", folder: "attachments", name: "cat.png" },
			},
		]);
	});

	it("opens a file in a new split to the right or below", () => {
		expect(
			opened('(ui/open-file "knowledge" "a.md" :split "down")').ops[0],
		).toMatchObject({ split: "down" });
	});

	it("rejects a split or a folder it cannot place", () => {
		const { interp } = fresh();
		expect(() =>
			runSync(interp, '(ui/open-file "knowledge" "a.md" :split "left")'),
		).toThrow(/unknown split/);
		expect(() => runSync(interp, '(ui/open-file "bin" "a.md")')).toThrow(
			/unknown folder/,
		);
	});

	it("opens a widget as a view tab keyed by its title", () => {
		const { ops, result } = opened(
			'(ui/open-view "counts" (ui/kpi "open" 3) :split "right")',
		);
		expect(result).toBe(viewTab("counts"));
		expect(ops[0]).toEqual({
			op: "open",
			tab: "view:counts",
			split: "right",
			content: {
				kind: "view",
				title: "counts",
				node: {
					tag: "kpi",
					props: { label: "open", value: "3" },
					children: [],
				},
			},
		});
	});

	it("refuses to open something that is not a widget as a view", () => {
		const { interp } = fresh();
		expect(() => runSync(interp, '(ui/open-view "x" 3)')).toThrow(
			/ui element expected/,
		);
	});

	const saved: PanelTab[] = [
		{
			id: "file:knowledge/notes.md",
			kind: "file",
			title: "notes.md",
			shown: true,
			focused: true,
		},
		{
			id: "view:counts",
			kind: "view",
			title: "counts",
			shown: false,
			focused: false,
		},
	];

	function onPanel(tabs: PanelTab[]) {
		const { panel, ops } = panelOf(tabs);
		const interp = new Interp({
			extensions: [uiExtension(uiHostFor({ panel }))],
		});
		runSync(interp, prelude);
		return { ops, ev: (code: string) => str(runSync(interp, code)) };
	}

	it("lists the tabs the panel reader reports", () => {
		expect(onPanel(saved).ev("(ui/tabs)")).toBe(
			'((:id "file:knowledge/notes.md" :kind :file :title "notes.md" :shown t :focused t) (:id "view:counts" :kind :view :title "counts" :shown nil :focused nil))',
		);
	});

	it("lists the tabs this step opened and closed", () => {
		const { ev } = onPanel(saved);
		ev('(ui/open-view "plan" (ui/text "x")) (ui/close "view:counts")');
		expect(ev("(ui/tabs)")).toBe(
			'((:id "file:knowledge/notes.md" :kind :file :title "notes.md" :shown t :focused nil) (:id "view:plan" :kind :view :title "plan" :shown t :focused t))',
		);
	});

	it("closes an open tab and says whether there was one", () => {
		const { ev, ops } = onPanel(saved);
		expect(ev('(ui/close "view:counts")')).toBe("t");
		expect(ev('(ui/close "view:counts")')).toBe("nil");
		expect(ev('(ui/close "view:gone")')).toBe("nil");
		expect(ops).toEqual([{ op: "close", tab: "view:counts" }]);
	});

	it("lists no tabs without a panel", () => {
		const { interp } = fresh();
		expect(str(runSync(interp, "(ui/tabs)"))).toBe("nil");
	});

	it("closes and focuses tabs by id", () => {
		const { ops, result } = opened(
			'(ui/open-view "counts" (ui/text "1")) (ui/focus "view:counts") (ui/close "view:counts")',
		);
		expect(ops.slice(1)).toEqual([
			{ op: "focus", tab: "view:counts" },
			{ op: "close", tab: "view:counts" },
		]);
		expect(str(result)).toBe("t");
	});

	it("puts nothing under the message when it opens a tab", () => {
		const { interp, ui } = fresh();
		runSync(interp, '(ui/open-file "knowledge" "a.md")');
		expect(ui.takeView()).toBeUndefined();
	});
});

describe("the catalog the frontend draws from", () => {
	function tagsOf(node: UiNode): string[] {
		return [node.tag, ...node.children.flatMap(tagsOf)];
	}

	function strays(node: UiNode): string[] {
		const own = widgetOf(node) === undefined ? [node.tag] : [];
		return [...own, ...node.children.flatMap(strays)];
	}

	it("holds every widget this surface builds, and nothing more", () => {
		const { interp, ui } = fresh();
		runSync(
			interp,
			`(ui/render
			   (ui/stack
			     (ui/text 1) (ui/heading "h") (ui/markdown "m")
			     (ui/link "l" "https://x.dev") (ui/file-link "f" "knowledge" "a.pdf")
			     (ui/badge "b") (ui/badge "b" :tone "warn")
			     (ui/kpi "k" 2) (ui/kpi "k" 2 :hint "h")
			     (ui/row (ui/card "c" "x"))
			     (ui/button "go" (lambda () nil))
			     (ui/form (lambda (v) v)
			       (ui/input :name "q" :label "Q" :placeholder "p" :value "v")
			       (ui/select '("a") :name "s" :value "a" :on-change (lambda (v) v))
			       (ui/checkbox :name "c" :checked t :on-change (lambda (v) v))
			       :submit "Send")
			     (ui/table (list (list (cons "id" 1))))))`,
		);
		const view = ui.takeView();
		if (view === undefined) throw new Error("nothing rendered");
		expect(strays(view)).toEqual([]);
		expect(new Set(tagsOf(view))).toEqual(new Set(TAGS));
	});
});

describe("the widget form table", () => {
	it("builds a widget of its own tag from every example", () => {
		for (const tag of TAGS) {
			const { interp, ui } = fresh();
			runSync(interp, `(ui/render ${WIDGET_FORMS[tag].example})`);
			const node = ui.takeView();
			if (node === undefined) throw new Error(`${tag} rendered nothing`);
			expect(node.tag).toBe(tag);
			expect(widgetOf(node)).toBeDefined();
		}
	});

	it("lists every constructor in the prompt", () => {
		const { prompt } = uiExtension(uiHostFor({ panel: panelOf([]).panel }));
		expect(prompt).not.toContain("{{widgets}}");
		for (const tag of TAGS)
			expect(prompt).toContain(WIDGET_FORMS[tag].signature);
	});
});
