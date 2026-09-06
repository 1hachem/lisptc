import { describe, expect, it } from "vitest";
import { Interp, prelude, run, setWriter, str } from "../src/lisp.ts";
import {
	joinMessages,
	nodeToJson,
	UI,
	type UiEvent,
	type UiNode,
	UiSurface,
	type UiValue,
	uiExtension,
} from "../src/ui.ts";

function collector(interp: Interp) {
	let view: UiNode | undefined;
	let messages: string[] = [];
	interp.channels.on(UI, (d) => {
		const event = d.value as UiEvent;
		if (event.kind === "view") view = event.node;
		else messages.push(event.text);
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
} {
	const surface = new UiSurface();
	const interp = new Interp({ extensions: [uiExtension(surface)] });
	run(interp, prelude);
	return { interp, surface, ui: collector(interp) };
}

function render(code: string): {
	view: UiValue | undefined;
	surface: UiSurface;
	interp: Interp;
	ui: ReturnType<typeof collector>;
} {
	const { interp, surface, ui } = fresh();
	run(interp, code);
	const node = ui.takeView();
	return { view: node ? nodeToJson(node) : undefined, surface, interp, ui };
}

describe("building a view", () => {
	it("renders nothing until ui/render is called", () => {
		const { interp, ui } = fresh();
		run(interp, '(ui/stack (ui/text "hi"))');
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
				run(
					interp,
					'(ui/render (ui/row (ui/button "a" (lambda () nil)) (ui/button "b" (lambda () nil))))',
				),
			),
		).toBe('"rendered row, 3 elements, 2 actions"');
	});

	it("takeView reads and clears, so a later step does not redraw it", () => {
		const { interp, ui } = fresh();
		run(interp, '(ui/render (ui/text "once"))');
		expect(ui.takeView()).toBeDefined();
		expect(ui.takeView()).toBeUndefined();
	});

	it("refuses to render anything that is not a widget", () => {
		const { interp } = fresh();
		expect(() => run(interp, '(ui/render "just text")')).toThrow(
			/ui element expected/,
		);
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
		expect(() => run(interp, '(ui/badge "open" :tone "chartreuse")')).toThrow(
			/unknown tone/,
		);
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

	it("needs a :name on a checkbox, as on every other field", () => {
		const { interp } = fresh();
		expect(() => run(interp, "(ui/checkbox)")).toThrow(
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
		expect(() => run(interp, '(ui/button "go" "not a function")')).toThrow(
			/function expected as a ui action/,
		);
	});

	it("runs the handler against the live session", () => {
		const { surface, interp } = render(`
			(setq clicks 0)
			(ui/render (ui/button "+1" (lambda () (setq clicks (+ clicks 1)) (ui/render (ui/text "ok")))))
		`);
		surface.invoke("a1", {});
		surface.invoke("a1", {});
		expect(str(run(interp, "(identity clicks)"))).toBe("2");
	});

	it("hands a handler that takes an argument the submitted fields", () => {
		const { surface, interp } = render(`
			(ui/render (ui/form (lambda (values) (setq seen (cdr (assoc "q" values))))
				(ui/input :name "q")))
		`);
		surface.invoke("a1", { q: "auth" });
		expect(str(run(interp, "(identity seen)"))).toBe('"auth"');
	});

	it("calls a zero-argument handler with no arguments", () => {
		const { surface, interp } = render(`
			(setq hits 0)
			(ui/render (ui/button "go" (lambda () (setq hits (+ hits 1)))))
		`);
		expect(() => surface.invoke("a1", { q: "ignored" })).not.toThrow();
		expect(str(run(interp, "(identity hits)"))).toBe("1");
	});

	it("replaces the view with whatever the handler rendered", () => {
		const { surface, ui } = render(`
			(setq n 0)
			(defun panel () (ui/stack (ui/text (string n))
				(ui/button "+1" (lambda () (setq n (+ n 1)) (ui/render (panel))))))
			(ui/render (panel))
		`);
		surface.invoke("a1", {});
		expect(nodeToJson(ui.takeView() as never)).toMatchObject({
			children: [{ tag: "text", props: { text: "1" } }, { tag: "button" }],
		});
	});

	it("reports an id it does not know rather than doing nothing", () => {
		const { surface } = render('(ui/render (ui/text "hi"))');
		expect(() => surface.invoke("a99", {})).toThrow(/no such ui action/);
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

	it("runs an :on-change against the live session", () => {
		const { surface, ui } = render(`
			(ui/render (ui/select '("7" "30") :name "d"
				:on-change (lambda (values) (ui/render (ui/text (cdr (assoc "d" values)))))))
		`);
		surface.invoke("a1", { d: "30" });
		expect(nodeToJson(ui.takeView() as never)).toMatchObject({
			props: { text: "30" },
		});
	});

	it("hands a checkbox's value over as a boolean a handler can test", () => {
		const { surface, interp } = render(`
			(ui/render (ui/form (lambda (values)
				(setq seen (if (cdr (assoc "open" values)) "on" "off")))
				(ui/checkbox :name "open")))
		`);
		surface.invoke("a1", { open: true });
		expect(str(run(interp, "(identity seen)"))).toBe('"on"');
		surface.invoke("a1", { open: false });
		expect(str(run(interp, "(identity seen)"))).toBe('"off"');
	});

	it("counts an :on-change in the render summary", () => {
		const { interp } = fresh();
		expect(
			str(
				run(
					interp,
					`(ui/render (ui/row (ui/button "go" (lambda () nil))
						(ui/checkbox :name "o" :on-change (lambda (v) nil))))`,
				),
			),
		).toBe('"rendered row, 3 elements, 2 actions"');
	});

	it("lets a handler echo", () => {
		const { surface } = render(
			'(ui/render (ui/button "say" (lambda () (echo "from the click"))))',
		);
		let written = "";
		const prev = setWriter((s) => {
			written += s;
		});
		try {
			surface.invoke("a1", {});
		} finally {
			setWriter(prev);
		}
		expect(written).toBe("from the click\n");
	});
});

describe("handing a turn back to the agent", () => {
	it("carries a handler's message out, joining the arguments like echo", () => {
		const { surface, ui } = render(`
			(ui/render (ui/form (lambda (values) (ui/send "search for" (cdr (assoc "q" values))))
				(ui/input :name "q")))
		`);
		surface.invoke("a1", { q: "auth" });
		expect(ui.takeMessage()).toBe("search for auth");
	});

	it("reads and clears, so a message is delivered once", () => {
		const { surface, ui } = render(
			'(ui/render (ui/button "go" (lambda () (ui/send "go"))))',
		);
		surface.invoke("a1", {});
		expect(ui.takeMessage()).toBe("go");
		expect(ui.takeMessage()).toBeUndefined();
	});

	it("joins several sends in a handler into a single message", () => {
		const { surface, ui } = render(
			'(ui/render (ui/button "go" (lambda () (ui/send "first") (ui/send "second"))))',
		);
		surface.invoke("a1", {});
		expect(ui.takeMessage()).toBe("first\n\nsecond");
	});

	it("lets a handler render and send in the same click", () => {
		const { surface, ui } = render(`
			(ui/render (ui/button "go" (lambda () (ui/render (ui/text "working…")) (ui/send "do it"))))
		`);
		surface.invoke("a1", {});
		expect(nodeToJson(ui.takeView() as never)).toMatchObject({
			props: { text: "working…" },
		});
		expect(ui.takeMessage()).toBe("do it");
	});

	it("caps a message rather than letting a handler post an essay", () => {
		const { surface, ui } = render(`
			(defun wide (n) (let ((s "")) (dotimes (i n) (setq s (concat s "abcdefghij"))) s))
			(ui/render (ui/button "go" (lambda () (ui/send (wide 600)))))
		`);
		surface.invoke("a1", {});
		const message = ui.takeMessage() ?? "";
		expect(message.length).toBeLessThan(4100);
		expect(message).toMatch(/message truncated/);
	});

	it("reports no message for a click that sent nothing", () => {
		const { surface, ui } = render(
			'(ui/render (ui/button "go" (lambda () (ui/render (ui/text "x")))))',
		);
		surface.invoke("a1", {});
		expect(ui.takeMessage()).toBeUndefined();
	});
});
