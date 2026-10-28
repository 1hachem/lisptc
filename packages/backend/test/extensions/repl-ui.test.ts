import { Compactor } from "@repo/compaction-extension";
import type { EvalOutput } from "@repo/repl/repl";
import { MemoryViewStore, type PanelOp } from "@repo/ui-extension";
import { describe, expect, it } from "vitest";
import { agentRepl, memoryRepl, modelFacing } from "./helpers.ts";

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

const view = (out: EvalOutput): unknown => out.annotations.output.ui;

function stored() {
	const views = new MemoryViewStore();
	const r = memoryRepl(modelFacing(undefined, undefined, undefined, views));
	const node = (out: EvalOutput): unknown => {
		const ref = view(out) as { viewId: string } | undefined;
		return ref === undefined ? undefined : views.views.get(ref.viewId);
	};
	const label = (out: EvalOutput): unknown =>
		(node(out) as { children: { props: { text: string } }[] } | undefined)
			?.children[0]?.props.text;
	const buttonAction = (out: EvalOutput): string =>
		(node(out) as { children: { props: { action: string } }[] } | undefined)
			?.children[1]?.props.action ?? "";
	return { r, views, node, label, buttonAction };
}

describe("a step that renders", () => {
	it("hands the view back beside the output", async () => {
		const out = await memoryRepl().evalOutput(PANEL);
		const { model } = out;
		expect(view(out)).toBeDefined();
		expect(model).toContain("rendered stack");
		expect(model).not.toContain("ui/button");
	});

	it("reports no view for a step that rendered none", async () => {
		expect(view(await memoryRepl().evalOutput("(+ 1 2)"))).toBeUndefined();
	});

	it("renders a widget handed to echo instead of printing it", async () => {
		const { r, node } = stored();
		const out = await r.evalOutput(`(echo (ui/table '((("id" . 1)))))`);
		expect(node(out)).toMatchObject({ tag: "table" });
		expect(out.model).toContain("rendered table");
		expect(out.model).not.toContain("#<ui:");
	});

	it("leaves a text echo to compaction's cap", async () => {
		const r = memoryRepl(modelFacing(new Compactor(2)));
		const { model } = await r.evalOutput('(echo "one two three four")');
		expect(model).not.toContain("three four");
	});
});

describe("a step that opens panel tabs", () => {
	it("writes the panel ops through the panel port, in order", async () => {
		const ops: PanelOp[] = [];
		const panel = {
			apply: async (applied: readonly PanelOp[]) => void ops.push(...applied),
			tabs: () =>
				ops.some((op) => op.op === "open")
					? [
							{
								id: "file:knowledge/q3.pdf",
								kind: "file",
								title: "q3.pdf",
								shown: true,
								focused: true,
							},
						]
					: [],
		};
		const out = await memoryRepl(
			modelFacing(undefined, undefined, panel),
		).evalOutput(
			'(ui/open-file "knowledge" "q3.pdf" :split "right") (ui/close "file:knowledge/q3.pdf")',
		);
		expect(ops).toEqual([
			{
				op: "open",
				tab: "file:knowledge/q3.pdf",
				split: "right",
				content: { kind: "file", folder: "knowledge", name: "q3.pdf" },
			},
			{ op: "close", tab: "file:knowledge/q3.pdf" },
		]);
		expect(out.annotations.output).not.toHaveProperty("panel");
	});

	it("fails the step when the panel port refuses an op", async () => {
		const panel = {
			apply: async () => {
				throw new Error("layout too large");
			},
			tabs: () => [],
		};
		const out = await memoryRepl(
			modelFacing(undefined, undefined, panel),
		).evalOutput('(ui/focus "view:counts")');
		expect(out.failed).toBe(true);
	});
});

describe("a view whose handlers are gone", () => {
	it("is marked expired, and a click on it fails nothing", async () => {
		const views = new MemoryViewStore();
		const r = memoryRepl(modelFacing(undefined, undefined, undefined, views));
		await r.evalOutput(
			'(setq view (ui/button "go" (lambda () 1))) (ui/render view)',
		);
		await r.evalOutput("(ui/forget view)");
		expect([...views.expired]).toEqual(["v1"]);
		const out = await r.invokeUi("a1", {});
		expect(out.failed).toBe(false);
	});
});

describe("a view while its step runs", () => {
	it("reaches the caller live as a reference, never as the tree", async () => {
		const pushed: unknown[] = [];
		const slow = {
			put: () => new Promise<void>((resolve) => setTimeout(resolve, 300)),
			expire: () => undefined,
		};
		const r = agentRepl(modelFacing(undefined, undefined, undefined, slow));
		await r.evalOutput(
			'(ui/render (ui/text "a")) (ui/render (ui/text "b"))',
			undefined,
			(output) => pushed.push(output.ui),
		);
		expect(pushed.length).toBeGreaterThan(0);
		for (const ui of pushed) expect(ui).toEqual({ viewId: "v1" });
	});
});

describe("driving the view", () => {
	it("runs a click in the same session and renders back into the clicked view", async () => {
		const { r, label, buttonAction } = stored();
		const first = await r.evalOutput(PANEL);
		expect(label(first)).toBe("count 0");
		const clicked = await r.invokeUi("a1");
		expect(view(clicked)).toEqual(view(first));
		expect(label(clicked)).toBe("count 1");
		expect(label(await r.invokeUi(buttonAction(clicked)))).toBe("count 2");
	});

	it("gives each step that renders a view of its own", async () => {
		const { r } = stored();
		const one = await r.evalOutput('(ui/render (ui/text "a"))');
		const two = await r.evalOutput('(ui/render (ui/text "b"))');
		expect(view(one)).not.toEqual(view(two));
	});

	it("passes a submitted form's fields to its handler", async () => {
		const { r, label } = stored();
		await r.evalOutput(PANEL);
		expect(label(await r.invokeUi("a2", { to: "42" }))).toBe("count 42");
	});

	it("renders a handler's echo for the human without capping it", async () => {
		const r = memoryRepl(modelFacing(new Compactor(2)));
		await r.evalOutput(
			'(ui/render (ui/button "say" (lambda () (echo "one two three four"))))',
		);
		const { user, failed } = await r.invokeUi("a1");
		expect(user).toBe("one two three four\n");
		expect(failed).toBe(false);
	});

	it("reports a failing handler as an error rather than throwing", async () => {
		const r = memoryRepl();
		await r.evalOutput(
			'(ui/render (ui/button "boom" (lambda () (no-such-fn))))',
		);
		const out = await r.invokeUi("a1");
		expect(out.failed).toBe(true);
		expect(out.model).toMatch(/no-such-fn/);
		expect(out.user).toBe("");
		expect(view(out)).toBeUndefined();
	});

	it("reports an unknown action instead of silently doing nothing", async () => {
		const r = memoryRepl();
		await r.evalOutput(PANEL);
		expect((await r.invokeUi("a99")).model).toMatch(/no such ui action/);
	});

	it("drops every action on reset", async () => {
		const r = memoryRepl();
		await r.evalOutput(PANEL);
		r.reset();
		expect((await r.invokeUi("a1")).model).toMatch(/no such ui action/);
	});
});

describe("handing a turn back to the agent", () => {
	it("returns a handler's message beside its view", async () => {
		const r = memoryRepl();
		await r.evalOutput(`
			(ui/render (ui/form (lambda (v) (ui/render (ui/text "asking…")) (ui/send "find" (cdr (assoc "q" v))))
				(ui/input :name "q") :submit "ask"))
		`);
		const out = await r.invokeUi("a1", { q: "auth" });
		expect(out.message).toBe("find auth");
		expect(view(out)).toBeDefined();
	});

	it("reports no message for a click that only rendered", async () => {
		const r = memoryRepl();
		await r.evalOutput(PANEL);
		expect((await r.invokeUi("a1")).message).toBeUndefined();
	});

	it("does not carry a send from an ordinary eval into the next click", async () => {
		const r = memoryRepl();
		expect((await r.evalOutput('(ui/send "stray")')).message).toBe("stray");
		await r.evalOutput(PANEL);
		expect((await r.invokeUi("a1")).message).toBeUndefined();
	});
});
