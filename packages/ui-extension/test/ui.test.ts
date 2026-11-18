import type { Conversation } from "@repo/interpreter/conversation";
import { restore, snapshot } from "@repo/interpreter/image";
import { bufferSink } from "@repo/interpreter/journal";
import { boot, Interp, runSync } from "@repo/interpreter/lisp";
import { str } from "@repo/interpreter/print";
import { viewKind } from "@repo/journal-catalog/view";
import { TAGS, widgetOf } from "@repo/ui-catalog";
import { describe, expect, it } from "vitest";
import {
	fileTab,
	nodeToJson,
	type PanelOp,
	type PanelStore,
	type PanelTab,
	type UiNode,
	UiSurface,
	type UiValue,
	uiExtension,
} from "../src/ui.ts";
import { uiHostFor } from "../src/ui-host.ts";
import { MemoryViewStore } from "../src/view-store.ts";
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

function collector(interp: Interp, views: MemoryViewStore) {
	let viewId: string | undefined;
	let requests: { source: string; content: string }[] = [];
	interp.journal.onAny((entry) => {
		if (entry.kind === viewKind.name)
			viewId = (entry.value as { viewId: string }).viewId;
	});
	const conversation: Conversation = {
		records: () => [],
		append: () => {},
		request: (source, content) => {
			requests.push({ source, content });
		},
	};
	return {
		conversation,
		takeView(): UiNode | undefined {
			const v = viewId === undefined ? undefined : views.views.get(viewId);
			viewId = undefined;
			return v;
		},
		takeRequests(): { source: string; content: string }[] {
			const taken = requests;
			requests = [];
			return taken;
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
	const views = new MemoryViewStore();
	const host = uiHostFor({ panel, views });
	const interp = new Interp({ extensions: [uiExtension(host, { surface })] });
	boot(interp);
	return { interp, surface, ui: collector(interp, views), ops };
}

async function click(
	surface: UiSurface,
	ui: ReturnType<typeof collector>,
	action: string,
	values: Record<string, unknown> = {},
): Promise<void> {
	surface.enter(action, ui.conversation);
	await surface.invoke(action, values);
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
		const buffer = bufferSink();
		const detach = interp.journal.pipe(buffer);
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
});

describe("the display widgets", () => {
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

	it("prints a non-string ui/text the way echo would", () => {
		expect(render("(ui/render (ui/text 42))").view).toEqual({
			tag: "text",
			props: { text: "42" },
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
			/function or quoted call expected as a ui action/,
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
		expect(surface.hasAction("a1")).toBe(false);
		expect(str(runSync(interp, "(ui/forget view)"))).toBe("0");
	});

	it("reports an id it does not know rather than doing nothing", async () => {
		const { surface } = render('(ui/render (ui/text "hi"))');
		await expect(surface.invoke("a99", {})).rejects.toThrow(
			/no such ui action/,
		);
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
});

describe("handing a turn back to the agent", () => {
	it("delivers nothing from a send outside a handler", async () => {
		const { surface, interp, ui } = render(
			'(ui/render (ui/button "go" (lambda () (ui/send "go"))))',
		);
		runSync(interp, '(ui/send "stray")');
		expect(ui.takeRequests()).toEqual([]);
		await click(surface, ui, "a1");
		expect(ui.takeRequests()).toEqual([{ source: "a1", content: "go" }]);
		surface.beginStep();
		runSync(interp, '(ui/send "late")');
		expect(ui.takeRequests()).toEqual([]);
	});

	it("delivers each send in a handler as its own request", async () => {
		const { surface, ui } = render(
			'(ui/render (ui/button "go" (lambda () (ui/send "first") (ui/send "second"))))',
		);
		await click(surface, ui, "a1");
		expect(ui.takeRequests()).toEqual([
			{ source: "a1", content: "first" },
			{ source: "a1", content: "second" },
		]);
	});

	it("lets a handler render and send in the same click", async () => {
		const { surface, ui } = render(`
			(ui/render (ui/button "go" (lambda () (ui/render (ui/text "working…")) (ui/send "do it"))))
		`);
		await click(surface, ui, "a1");
		expect(nodeToJson(ui.takeView() as never)).toMatchObject({
			props: { text: "working…" },
		});
		expect(ui.takeRequests()).toEqual([{ source: "a1", content: "do it" }]);
	});

	it("caps a message rather than letting a handler post an essay", async () => {
		const { surface, ui } = render(`
			(defun wide (n) (let ((s "")) (dotimes (i n) (setq s (concat s "abcdefghij"))) s))
			(ui/render (ui/button "go" (lambda () (ui/send (wide 600)))))
		`);
		await click(surface, ui, "a1");
		const [request] = ui.takeRequests();
		expect(request.content.length).toBeLessThan(4100);
		expect(request.content).toMatch(/message truncated/);
	});

	it("reports no message for a click that sent nothing", async () => {
		const { surface, ui } = render(
			'(ui/render (ui/button "go" (lambda () (ui/render (ui/text "x")))))',
		);
		await click(surface, ui, "a1");
		expect(ui.takeRequests()).toEqual([]);
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

	it("rejects a split or a folder it cannot place", () => {
		const { interp } = fresh();
		expect(() =>
			runSync(interp, '(ui/open-file "knowledge" "a.md" :split "left")'),
		).toThrow(/unknown split/);
		expect(() => runSync(interp, '(ui/open-file "bin" "a.md")')).toThrow(
			/unknown folder/,
		);
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
		boot(interp);
		return { ops, ev: (code: string) => str(runSync(interp, code)) };
	}

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

	it.each(TAGS)("draws the example its prompt teaches for %s", (tag) => {
		const { interp, ui } = fresh();
		runSync(interp, `(ui/render ${WIDGET_FORMS[tag].example})`);
		const node = ui.takeView();
		expect(node?.tag).toBe(tag);
		expect(node && widgetOf(node)).toBeDefined();
	});

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

describe("ui-widgets", () => {
	it("names every widget constructor", () => {
		const { interp } = fresh();
		expect(str(runSync(interp, "(length ui-widgets)"))).toBe(
			String(TAGS.length),
		);
		for (const tag of TAGS)
			expect(str(runSync(interp, `(member "ui/${tag}" ui-widgets)`))).not.toBe(
				"nil",
			);
	});

	it("cannot be overwritten", () => {
		const { interp } = fresh();
		expect(() => runSync(interp, "(setq ui-widgets nil)")).toThrow();
	});
});

describe("the view store", () => {
	function stored() {
		const surface = new UiSurface();
		const views = new MemoryViewStore();
		const host = uiHostFor({ panel: panelOf([]).panel, views });
		const interp = new Interp({ extensions: [uiExtension(host, { surface })] });
		boot(interp);
		const drawn: string[] = [];
		interp.journal.onAny((entry) => {
			if (entry.kind !== viewKind.name) return;
			const { viewId } = entry.value as { viewId: string };
			if (!drawn.includes(viewId)) drawn.push(viewId);
		});
		return { surface, views, interp, drawn, ui: collector(interp, views) };
	}

	it("writes every render of a step into one view", () => {
		const { surface, views, interp } = stored();
		surface.beginStep();
		runSync(interp, '(ui/render (ui/text "a")) (ui/render (ui/text "b"))');
		expect([...views.views.values()]).toMatchObject([{ props: { text: "b" } }]);
		surface.beginStep();
		runSync(interp, '(ui/render (ui/text "c"))');
		expect([...views.views.values()]).toMatchObject([
			{ props: { text: "b" } },
			{ props: { text: "c" } },
		]);
	});

	it("renders a click back into the view the control was in", async () => {
		const { surface, views, interp, ui } = stored();
		surface.beginStep();
		runSync(
			interp,
			`(setq n 0)
			(defun panel () (ui/stack (ui/text (string n))
				(ui/button "+1" (lambda () (setq n (+ n 1)) (ui/render (panel))))))
			(ui/render (panel))`,
		);
		surface.beginStep();
		runSync(interp, '(ui/render (ui/text "other"))');
		await click(surface, ui, "a1");
		expect(views.views.get("v1")).toMatchObject({
			children: [{ props: { text: "1" } }, { tag: "button" }],
		});
		expect(views.views.get("v2")).toMatchObject({ props: { text: "other" } });
	});

	it("renders a click on a panel view back into that view", async () => {
		const { surface, views, interp, ui } = stored();
		surface.beginStep();
		runSync(
			interp,
			`(setq n 0)
			(defun panel () (ui/stack (ui/text (string n))
				(ui/button "+1" (lambda () (setq n (+ n 1)) (ui/render (panel))))))
			(ui/open-view "counts" (panel))`,
		);
		await click(surface, ui, "a1");
		expect([...views.views.values()]).toMatchObject([
			{ children: [{ props: { text: "1" } }, { tag: "button" }] },
		]);
	});

	it("marks a view expired when ui/forget drops its handlers", () => {
		const { surface, views, interp, drawn } = stored();
		surface.beginStep();
		runSync(
			interp,
			'(setq view (ui/stack (ui/button "a" (lambda () 1)))) (ui/render view)',
		);
		surface.beginStep();
		runSync(interp, "(ui/forget view)");
		expect([...views.expired]).toEqual(drawn);
	});

	it("marks a view expired when a click finds its handler gone", async () => {
		const { surface, views, interp, drawn } = stored();
		surface.beginStep();
		runSync(interp, '(ui/render (ui/button "a" (lambda () 1)))');
		surface.reset();
		await surface.invoke("a1", {});
		expect([...views.expired]).toEqual(drawn);
	});

	it("still reports an id no view ever carried", async () => {
		const { surface } = stored();
		await expect(surface.invoke("a99", {})).rejects.toThrow(
			/no such ui action/,
		);
	});

	it("clears the expired mark when the view is drawn again", () => {
		const { surface, views, interp, drawn } = stored();
		surface.beginStep();
		runSync(
			interp,
			'(setq view (ui/stack (ui/button "a" (lambda () 1)))) (ui/render view) (ui/forget view)',
		);
		expect([...views.expired]).toEqual(drawn);
		runSync(interp, "(ui/render view)");
		expect(views.expired.size).toBe(0);
	});
});

describe("a quoted call as an action", () => {
	const SETUP = `
		(setq log nil)
		(defun refresh () (setq log (cons "refresh" log)))
		(defun set-filter (f) (setq log (cons f log)))
		(defun pick (f values) (setq log (cons (concat f "=" (cdr (assoc "q" values))) log)))
	`;

	it("runs a named function with its quoted arguments", async () => {
		const { surface, interp } = render(
			`${SETUP} (ui/render (ui/row (ui/button "r" '(refresh)) (ui/button "o" '(set-filter "open"))))`,
		);
		await surface.invoke("a1", {});
		await surface.invoke("a2", { q: "x" });
		expect(str(runSync(interp, "log"))).toBe('("open" "refresh")');
	});

	it("appends the values when the function takes one more argument", async () => {
		const { surface, interp } = render(
			`${SETUP} (ui/render (ui/form '(pick "k") (ui/input :name "q")))`,
		);
		await surface.invoke("a1", { q: "auth" });
		expect(str(runSync(interp, "log"))).toBe('("k=auth")');
	});

	it("holds one handler for two controls making the same call", () => {
		const { interp } = render(
			`${SETUP} (setq view (ui/row (ui/button "a" '(refresh)) (ui/button "b" '(refresh)))) (ui/render view)`,
		);
		expect(str(runSync(interp, "(ui/forget view)"))).toBe("1");
	});

	it("survives a restore that drops every closure", async () => {
		const before = render(
			`${SETUP} (ui/render (ui/button "o" '(set-filter "open")))`,
		);
		const image = JSON.parse(JSON.stringify(snapshot(before.interp)));
		const after = fresh();
		restore(after.interp, image);
		await after.surface.invoke("a1", {});
		expect(str(runSync(after.interp, "log"))).toBe('("open")');
	});

	it("names the function a click could not find", async () => {
		const { surface } = render(`(ui/render (ui/button "x" '(no-such-fn)))`);
		await expect(surface.invoke("a1", {})).rejects.toThrow(
			/not defined.*no-such-fn|no-such-fn.*not defined/s,
		);
	});
});
