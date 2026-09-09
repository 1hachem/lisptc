import { nodeToJson } from "@repo/interpreter/ui";
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
	it("hands the view back beside the output", async () => {
		const r = new MemoryRepl();
		const { view, model } = await r.evalOutput(PANEL);
		expect(view).toBeDefined();
		expect(model).toContain("rendered stack");
		expect(model).not.toContain("ui/button");
	});

	it("reports no view for a step that rendered none", async () => {
		const r = new MemoryRepl();
		expect((await r.evalOutput("(+ 1 2)")).view).toBeUndefined();
	});
});

describe("driving the view", () => {
	it("runs a click in the same session and answers with the new view", async () => {
		const r = new MemoryRepl();
		expect(label((await r.evalOutput(PANEL)).view)).toBe("count 0");
		const clicked = await r.invokeUi("a1");
		expect(label(clicked.view)).toBe("count 1");
		expect(label((await r.invokeUi(buttonAction(clicked.view))).view)).toBe(
			"count 2",
		);
	});

	it("passes a submitted form's fields to its handler", async () => {
		const r = new MemoryRepl();
		await r.evalOutput(PANEL);
		expect(label((await r.invokeUi("a2", { to: "42" })).view)).toBe("count 42");
	});

	it("renders a handler's echo for the human without capping it", async () => {
		const r = new MemoryRepl({ wordLimit: 2 });
		await r.evalOutput(
			'(ui/render (ui/button "say" (lambda () (echo "one two three four"))))',
		);
		const { user, error } = await r.invokeUi("a1");
		expect(user).toBe("one two three four\n");
		expect(error).toBe(false);
	});

	it("reports a failing handler as an error rather than throwing", async () => {
		const r = new MemoryRepl();
		await r.evalOutput(
			'(ui/render (ui/button "boom" (lambda () (no-such-fn))))',
		);
		const { user, error, view } = await r.invokeUi("a1");
		expect(error).toBe(true);
		expect(user).toMatch(/no-such-fn/);
		expect(view).toBeUndefined();
	});

	it("reports an unknown action instead of silently doing nothing", async () => {
		const r = new MemoryRepl();
		await r.evalOutput(PANEL);
		expect((await r.invokeUi("a99")).user).toMatch(/no such ui action/);
	});

	it("drops every action on reset", async () => {
		const r = new MemoryRepl();
		await r.evalOutput(PANEL);
		r.reset();
		expect((await r.invokeUi("a1")).user).toMatch(/no such ui action/);
	});
});

describe("handing a turn back to the agent", () => {
	it("returns a handler's message beside its view", async () => {
		const r = new MemoryRepl();
		await r.evalOutput(`
			(ui/render (ui/form (lambda (v) (ui/render (ui/text "asking…")) (ui/send "find" (cdr (assoc "q" v))))
				(ui/input :name "q") :submit "ask"))
		`);
		const { message, view } = await r.invokeUi("a1", { q: "auth" });
		expect(message).toBe("find auth");
		expect(view).toBeDefined();
	});

	it("reports no message for a click that only rendered", async () => {
		const r = new MemoryRepl();
		await r.evalOutput(PANEL);
		expect((await r.invokeUi("a1")).message).toBeUndefined();
	});

	it("does not carry a send from an ordinary eval into the next click", async () => {
		const r = new MemoryRepl();
		expect((await r.evalOutput('(ui/send "stray")')).message).toBe("stray");
		await r.evalOutput(PANEL);
		expect((await r.invokeUi("a1")).message).toBeUndefined();
	});
});
