import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driveAsync, settled } from "@repo/interpreter/drive";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import { openSession } from "@repo/interpreter/session";
import { describe, expect, it } from "vitest";
import { procedurePath } from "../src/ports.ts";
import { workspaceExtension } from "../src/workspace.ts";
import {
	findWorkspace,
	initWorkspace,
	workspaceHostFor,
} from "../src/workspace-host.ts";

function session(root: string) {
	const extension = workspaceExtension(workspaceHostFor(root));
	const hooks = openSession([extension]);
	const interp = new Interp({ extensions: [extension] });
	runSync(interp, prelude);
	const emitted: string[] = [];
	const step = async (code: string): Promise<string> => {
		let value: unknown;
		await hooks.evalStep.run(
			async (ctx) => {
				value = (await runAsync(ctx.interp, ctx.code)).value;
			},
			{ interp, code, emit: (text) => emitted.push(text) },
		);
		return str(value);
	};
	return { hooks, interp, step, emitted };
}

function freshWorkspace(): string {
	return initWorkspace(mkdtempSync(join(tmpdir(), "lisptc-ws-")));
}

function log(root: string): string[] {
	return execFileSync("git", ["-C", root, "log", "--format=%s"], {
		encoding: "utf8",
	})
		.trim()
		.split("\n");
}

describe("workspace", () => {
	it("loads a saved procedure in the next session", async () => {
		const root = freshWorkspace();
		const a = session(root);
		await a.step('(defun double (x) "twice x" (* x 2))');
		expect(await a.step("(proc/save 'double)")).toBe('"procedures/double.ptc"');
		expect(readFileSync(join(root, "procedures/double.ptc"), "utf8")).toBe(
			'(defun double (x)\n  "twice x"\n  (* x 2))\n',
		);

		const b = session(root);
		expect(await b.step("(double 21)")).toBe("42");
	});

	it("commits each step that changed a file", async () => {
		const root = freshWorkspace();
		const s = session(root);
		await s.step("(defun inc (x) (+ x 1))");
		await s.step("(proc/save 'inc)");
		await s.step("(+ 1 2)");
		await s.step("(proc/drop 'inc)");
		expect(log(root)).toEqual([
			"lisptc: drop inc",
			"lisptc: save inc",
			"lisptc: init workspace",
		]);
		expect(existsSync(join(root, "procedures/inc.ptc"))).toBe(false);
	});

	it("puts a slashed name in a directory", async () => {
		const root = freshWorkspace();
		const s = session(root);
		await s.step("(defun git/status? () t)");
		expect(await s.step("(proc/save 'git/status?)")).toBe(
			`"${procedurePath("git/status?")}"`,
		);
		expect(procedurePath("git/status?")).toBe("procedures/git/status%3F.ptc");
		await expect(session(root).step("(git/status?)")).resolves.toBe("t");
	});

	it("refuses to save a name nothing defined", async () => {
		const s = session(freshWorkspace());
		await expect(s.step("(proc/save 'nothing)")).rejects.toThrow(
			/define it first/,
		);
	});

	it("reports a file that fails to load and loads the rest", async () => {
		const root = freshWorkspace();
		writeFileSync(join(root, "procedures/bad.ptc"), "(undefined-thing)\n");
		writeFileSync(join(root, "procedures/good.ptc"), "(defun good () 1)\n");
		writeFileSync(join(root, "main.ptc"), "(setq started (good))\n");
		const s = session(root);
		expect(await s.step("started")).toBe("1");
		expect(s.emitted.join("")).toMatch(/procedures\/bad\.ptc/);
	});

	it("names the failures in the system prompt", async () => {
		const root = freshWorkspace();
		writeFileSync(join(root, "procedures/bad.ptc"), "(undefined-thing)\n");
		const s = session(root);
		const prompt = (
			await driveAsync(
				s.hooks.system.run((_i, p) => settled(p), s.interp, "base"),
			)
		).value;
		expect(prompt).toMatch(/^base\n\n<workspace>/);
		expect(prompt).toMatch(/procedures\/bad\.ptc/);
	});

	it("commits what changed under memories in the same step", async () => {
		const root = freshWorkspace();
		const s = session(root);
		writeFileSync(join(root, "memories/role.ptc"), '(memory "role")\n');
		await s.step("(+ 1 1)");
		expect(log(root)[0]).toBe("lisptc: update memories");
		await s.step("(+ 1 1)");
		expect(log(root)).toHaveLength(2);
	});

	it("finds the workspace from a directory inside it", () => {
		const root = freshWorkspace();
		expect(findWorkspace(join(root, "procedures"))).toBe(root);
	});
});
