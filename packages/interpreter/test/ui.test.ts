import { describe, expect, it } from "vitest";
import { Interp, prelude, run, setWriter, str } from "../src/lisp.ts";
import { nodeToJson, UiSurface, type UiValue, uiExtension } from "../src/ui.ts";

function fresh(): { interp: Interp; surface: UiSurface } {
	const surface = new UiSurface();
	const interp = new Interp({ extensions: [uiExtension(surface)] });
	run(interp, prelude);
	return { interp, surface };
}

// The tree as the frontend receives it — the only shape any of this is
// contracted on.
function render(code: string): {
	view: UiValue | undefined;
	surface: UiSurface;
	interp: Interp;
} {
	const { interp, surface } = fresh();
	run(interp, code);
	const node = surface.takeView();
	return { view: node ? nodeToJson(node) : undefined, surface, interp };
}

describe("building a view", () => {
	it("renders nothing until ui/render is called", () => {
		const { interp, surface } = fresh();
		run(interp, '(ui/stack (ui/text "hi"))');
		expect(surface.takeView()).toBeUndefined();
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

	// The model is told the render happened and nothing more: the widget is for
	// the user, and echoing it back would spend the context drawing it saved.
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
		const { interp, surface } = fresh();
		run(interp, '(ui/render (ui/text "once"))');
		expect(surface.takeView()).toBeDefined();
		expect(surface.takeView()).toBeUndefined();
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

	// The frontend maps a tone to one colour, so an unknown one would draw as no
	// colour at all — a badge that silently lost its meaning.
	it("rejects a tone the frontend cannot draw", () => {
		const { interp } = fresh();
		expect(() => run(interp, '(ui/badge "open" :tone "chartreuse")')).toThrow(
			/unknown tone/,
		);
	});

	// The model will reach for `(ui/kpi "open" (length rows))`, so a number has
	// to arrive as the digits and not as a Lisp printed form.
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
		// Absent, not false: the frontend can tell "no default" from "off".
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

	// The whole point: the click runs in the same interpreter, so it sees — and
	// changes — everything the turn that drew the widget built up.
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

	// `(lambda () …)` is the natural way to write a button that needs no input,
	// and it must not become an arity error just because a form was submitted.
	it("calls a zero-argument handler with no arguments", () => {
		const { surface, interp } = render(`
			(setq hits 0)
			(ui/render (ui/button "go" (lambda () (setq hits (+ hits 1)))))
		`);
		expect(() => surface.invoke("a1", { q: "ignored" })).not.toThrow();
		expect(str(run(interp, "(identity hits)"))).toBe("1");
	});

	it("replaces the view with whatever the handler rendered", () => {
		const { surface } = render(`
			(setq n 0)
			(defun panel () (ui/stack (ui/text (string n))
				(ui/button "+1" (lambda () (setq n (+ n 1)) (ui/render (panel))))))
			(ui/render (panel))
		`);
		surface.invoke("a1", {});
		expect(nodeToJson(surface.takeView() as never)).toMatchObject({
			children: [{ tag: "text", props: { text: "1" } }, { tag: "button" }],
		});
	});

	it("reports an id it does not know rather than doing nothing", () => {
		const { surface } = render('(ui/render (ui/text "hi"))');
		expect(() => surface.invoke("a99", {})).toThrow(/no such ui action/);
	});

	// A select or a checkbox that acts the moment it is used is how a view gets a
	// filter with no submit button — and it is still one action id on the wire.
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
		const { surface } = render(`
			(ui/render (ui/select '("7" "30") :name "d"
				:on-change (lambda (values) (ui/render (ui/text (cdr (assoc "d" values)))))))
		`);
		surface.invoke("a1", { d: "30" });
		expect(nodeToJson(surface.takeView() as never)).toMatchObject({
			props: { text: "30" },
		});
	});

	// The whole reason a checkbox sends a boolean: `""` and `"false"` are both
	// TRUE in Lisp, so a string-valued tick box could not be tested at all.
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

	// `summarize` reports the live action count to the model, so a prop it does
	// not know about would under-report what the view can do.
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

	// A handler is a step of the REPL like any other, so `echo` still writes.
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
		const { surface } = render(`
			(ui/render (ui/form (lambda (values) (ui/send "search for" (cdr (assoc "q" values))))
				(ui/input :name "q")))
		`);
		surface.invoke("a1", { q: "auth" });
		expect(surface.takeMessage()).toBe("search for auth");
	});

	it("reads and clears, so a message is delivered once", () => {
		const { surface } = render(
			'(ui/render (ui/button "go" (lambda () (ui/send "go"))))',
		);
		surface.invoke("a1", {});
		expect(surface.takeMessage()).toBe("go");
		expect(surface.takeMessage()).toBeUndefined();
	});

	// One click is one thing the user did, so it becomes one turn.
	it("joins several sends in a handler into a single message", () => {
		const { surface } = render(
			'(ui/render (ui/button "go" (lambda () (ui/send "first") (ui/send "second"))))',
		);
		surface.invoke("a1", {});
		expect(surface.takeMessage()).toBe("first\n\nsecond");
	});

	it("lets a handler render and send in the same click", () => {
		const { surface } = render(`
			(ui/render (ui/button "go" (lambda () (ui/render (ui/text "working…")) (ui/send "do it"))))
		`);
		surface.invoke("a1", {});
		expect(nodeToJson(surface.takeView() as never)).toMatchObject({
			props: { text: "working…" },
		});
		expect(surface.takeMessage()).toBe("do it");
	});

	// A sent message becomes a user turn, so it stays in the model's context on
	// every later turn — the one place a runaway handler would keep costing.
	it("caps a message rather than letting a handler post an essay", () => {
		const { surface } = render(`
			(defun wide (n) (let ((s "")) (dotimes (i n) (setq s (concat s "abcdefghij"))) s))
			(ui/render (ui/button "go" (lambda () (ui/send (wide 600)))))
		`);
		surface.invoke("a1", {});
		const message = surface.takeMessage() ?? "";
		expect(message.length).toBeLessThan(4100);
		expect(message).toMatch(/message truncated/);
	});

	it("reports no message for a click that sent nothing", () => {
		const { surface } = render(
			'(ui/render (ui/button "go" (lambda () (ui/render (ui/text "x")))))',
		);
		surface.invoke("a1", {});
		expect(surface.takeMessage()).toBeUndefined();
	});
});
