// @vitest-environment happy-dom

import type { Id } from "@repo/backend/dataModel";
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
	mutations: new Map<string, (args: unknown) => Promise<unknown>>(),
	reportIssue: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
		const name = getFunctionName(ref);
		return (args: unknown) =>
			(world.mutations.get(name) ?? (() => Promise.resolve(null)))(args);
	},
}));
vi.mock("../src/lib/analytics.tsx", () => ({
	reportIssue: world.reportIssue,
}));

import { useAttachmentUpload, useKnowledgeUpload } from "../src/lib/uploads.ts";

const WORKSPACE = "w1" as Id<"workspaces">;

type Hooks = {
	attachments: ReturnType<typeof useAttachmentUpload>;
	knowledge: ReturnType<typeof useKnowledgeUpload>;
};

let root: Root | undefined;

function mount(): Hooks {
	const hooks = {} as Hooks;
	function Probe() {
		hooks.attachments = useAttachmentUpload(WORKSPACE);
		hooks.knowledge = useKnowledgeUpload(WORKSPACE);
		return null;
	}
	root = createRoot(document.createElement("div"));
	act(() => root?.render(<Probe />));
	return hooks;
}

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	act(() => root?.unmount());
	world.mutations.clear();
	world.reportIssue.mockReset();
	vi.unstubAllGlobals();
});

describe("uploads", () => {
	it("reports a discard that fails to error tracking instead of dropping it", async () => {
		const failure = new Error("network down");
		world.mutations.set("files:discard", () => Promise.reject(failure));
		const hooks = mount();
		await act(async () => {
			hooks.attachments.discard("a.md");
		});
		expect(world.reportIssue).toHaveBeenCalledWith(failure, {
			$exception_source: "attachment discard",
		});
	});

	it("hands back the sanitized name an upload was stored under", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ storageId: "s1" })),
		);
		world.mutations.set("files:uploadUrl", async () => "https://up.test");
		world.mutations.set("files:add", async (args) => ({
			name: (args as { name: string }).name,
		}));
		const hooks = mount();
		const file = new File(["x"], "a/b.md", { type: "text/markdown" });
		await act(async () => {
			expect(await hooks.attachments.upload(file)).toBe("a-b.md");
		});
	});

	it("names the file and the reason when an upload is refused", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ storageId: "s1" })),
		);
		world.mutations.set("files:uploadUrl", async () => "https://up.test");
		world.mutations.set("files:add", async () => ({
			refused: "TOO_MANY_FILES",
		}));
		const hooks = mount();
		await act(async () => {
			await hooks.knowledge.upload([new File(["x"], "c.md")]);
		});
		expect(hooks.knowledge.failures).toEqual([
			"c.md not uploaded: the folder is full",
		]);
	});
});
