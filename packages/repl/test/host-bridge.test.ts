import { Interp, prelude, run, str } from "@repo/interpreter/lisp.ts";
import { describe, expect, it } from "vitest";
import { type HostToolSpec, installHostTools } from "../src/host-bridge.ts";

const TOOL_SPECS: HostToolSpec[] = [
	{
		hostName: "read_file",
		parameters: ["path", "offset", "limit"],
		defaults: [undefined, 1, 2000],
	},
	{
		hostName: "search_files",
		parameters: ["pattern", "target", "path"],
		defaults: [undefined, "content", "."],
	},
	{
		hostName: "fetch_urls",
		lispName: "fetch-urls",
		parameters: ["urls", "limit"],
		defaults: [undefined, null],
		parameterShapes: { urls: "array" },
	},
	{
		hostName: "save_data",
		parameters: ["path", "content"],
		defaults: [undefined, undefined],
	},
];

describe("host bridge", () => {
	it("composes two host tools and returns the reduced value", () => {
		const interp = new Interp();
		run(interp, prelude);
		const calls: string[] = [];
		installHostTools(interp, TOOL_SPECS.slice(0, 2), (tool, args) => {
			calls.push(tool);
			if (tool === "read_file")
				return { content: `contents:${String(args.path)}`, total_lines: 1 };
			return { matches: [{ file: "a.ts" }, { file: "b.ts" }] };
		});

		const result = run(
			interp,
			`(let ((f (read-file "notes.txt"))
			       (m (search-files "needle" "content" ".")))
			   (list (cdr (assoc "content" f))
			         (length (cdr (assoc "matches" m)))))`,
		);

		expect(str(result)).toBe('("contents:notes.txt" 2)');
		expect(calls).toEqual(["read_file", "search_files"]);
	});

	it("converts Lisp collections to JSON arrays and objects", () => {
		const interp = new Interp();
		run(interp, prelude);
		const seen: Record<string, unknown>[] = [];
		installHostTools(interp, TOOL_SPECS.slice(2), (_tool, args) => {
			seen.push(args);
			return { ok: true };
		});

		run(interp, "(fetch-urls nil)");
		run(interp, '(fetch-urls (list "https://a" "https://b"))');
		run(
			interp,
			'(save-data "out.json" (list (cons "nested" (list 1 2)) (cons "enabled" t)))',
		);

		expect(seen[0]).toEqual({ urls: [], limit: null });
		expect(seen[1]?.urls).toEqual(["https://a", "https://b"]);
		expect(seen[2]?.content).toEqual({ nested: [1, 2], enabled: true });
	});

	it("installs only supplied tools and rejects unsafe names", () => {
		const interp = new Interp();
		installHostTools(interp, [TOOL_SPECS[0]], () => null);
		expect(interp.globalNames()).toContain("read-file");
		expect(interp.globalNames()).not.toContain("search-files");
		expect(() =>
			installHostTools(
				interp,
				[{ hostName: "unsafe name", parameters: [] }],
				() => null,
			),
		).toThrow("Invalid host tool name");
	});
});
