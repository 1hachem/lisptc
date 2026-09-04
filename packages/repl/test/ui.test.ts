import { nodeToJson } from "@repo/interpreter/ui.ts";
import { describe, expect, it } from "vitest";
import { MemoryRepl } from "../src/repl.ts";

const PANEL = `
(setq n 0)
(defun panel ()
  (ui/stack
    (ui/text (concat "count " (string n)))
    (ui/button "+1" (lambda () (setq n (+ n 1)) (ui/render (panel))))
    (ui/form (lambda (values) (setq n (read (cdr (assoc "to" values)))) (ui/render (panel)))
      (ui/input :name "to")
      :submit "set")))
(ui/render (panel))
`;

const label = (view: unknown): unknown =>
	(nodeToJson(view as never) as { children: { props: { text: string } }[] })
		.children[0]?.props.text;

const buttonAction = (view: unknown): string =>
	(nodeToJson(view as never) as { children: { props: { action: string } }[] })
		.children[1]?.props.action ?? "";

describe("a step that renders", () => {
	it("hands the view back beside the output", () => {
		const r = new MemoryRepl();
		const { view, model } = r.evalOutput(PANEL);
		expect(view).toBeDefined();
		// The model's record of it is the summary line and nothing else — the
		// tree itself never enters its context.
		expect(model).toContain("rendered stack");
		expect(model).not.toContain("ui/button");
	});

	it("reports no view for a step that rendered none", () => {
		const r = new MemoryRepl();
		expect(r.evalOutput("(+ 1 2)").view).toBeUndefined();
	});
});

describe("driving the view", () => {
	it("runs a click in the same session and answers with the new view", () => {
		const r = new MemoryRepl();
		expect(label(r.evalOutput(PANEL).view)).toBe("count 0");
		const clicked = r.invokeUi("a1");
		expect(label(clicked.view)).toBe("count 1");
		// Every render mints fresh ids, so driving the view means following the
		// tree the last click returned rather than reusing the id just used.
		expect(label(r.invokeUi(buttonAction(clicked.view)).view)).toBe("count 2");
	});

	it("passes a submitted form's fields to its handler", () => {
		const r = new MemoryRepl();
		r.evalOutput(PANEL);
		expect(label(r.invokeUi("a2", { to: "42" }).view)).toBe("count 42");
	});

	it("renders a handler's echo for the human without capping it", () => {
		const r = new MemoryRepl({ wordLimit: 2 });
		r.evalOutput(
			'(ui/render (ui/button "say" (lambda () (echo "one two three four"))))',
		);
		const { user, error } = r.invokeUi("a1");
		expect(user).toBe("one two three four\n");
		expect(error).toBe(false);
	});

	it("reports a failing handler as an error rather than throwing", () => {
		const r = new MemoryRepl();
		r.evalOutput('(ui/render (ui/button "boom" (lambda () (no-such-fn))))');
		const { user, error, view } = r.invokeUi("a1");
		expect(error).toBe(true);
		expect(user).toMatch(/no-such-fn/);
		expect(view).toBeUndefined();
	});

	it("reports an unknown action instead of silently doing nothing", () => {
		const r = new MemoryRepl();
		r.evalOutput(PANEL);
		expect(r.invokeUi("a99").user).toMatch(/no such ui action/);
	});

	// The handlers close over the interp's environment, so they have to die with
	// it — a surviving action would run against globals that no longer exist.
	it("drops every action on reset", () => {
		const r = new MemoryRepl();
		r.evalOutput(PANEL);
		r.reset();
		expect(r.invokeUi("a1").user).toMatch(/no such ui action/);
	});
});

describe("handing a turn back to the agent", () => {
	it("returns a handler's message beside its view", () => {
		const r = new MemoryRepl();
		r.evalOutput(`
			(ui/render (ui/form (lambda (v) (ui/render (ui/text "asking…")) (ui/send "find" (cdr (assoc "q" v))))
				(ui/input :name "q") :submit "ask"))
		`);
		const { message, view } = r.invokeUi("a1", { q: "auth" });
		expect(message).toBe("find auth");
		expect(view).toBeDefined();
	});

	it("reports no message for a click that only rendered", () => {
		const r = new MemoryRepl();
		r.evalOutput(PANEL);
		expect(r.invokeUi("a1").message).toBeUndefined();
	});

	// An eval has no conversation to deliver into, so a stray send must not sit
	// in the outbox waiting to ride out on the next unrelated click.
	it("does not carry a send from an ordinary eval into the next click", () => {
		const r = new MemoryRepl();
		expect(r.evalOutput('(ui/send "stray")').message).toBe("stray");
		r.evalOutput(PANEL);
		expect(r.invokeUi("a1").message).toBeUndefined();
	});
});
