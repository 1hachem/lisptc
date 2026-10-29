import type { AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { landInApp, preloadAppChunks } from "../src/lib/land.ts";

describe("landing in the app after sign in", () => {
	it("loads the app as a full page so the server renders it with its data", () => {
		const replace = vi.fn();
		landInApp({ replace });
		expect(replace).toHaveBeenCalledWith("/app");
	});

	it("fetches the workspace chunks while auth is still in flight", () => {
		const loaded: string[] = [];
		const route = (id: string) => ({ id });
		const router = {
			routesById: {
				"/app": route("/app"),
				"/app/": route("/app/"),
				"/app/$workspaceId": route("/app/$workspaceId"),
				"/app/$workspaceId/": route("/app/$workspaceId/"),
				"/login": route("/login"),
			},
			loadRouteChunk: (r: { id: string }) => {
				loaded.push(r.id);
				return Promise.resolve();
			},
		} as unknown as AnyRouter;
		preloadAppChunks(router, "now");
		expect(loaded).toEqual([
			"/app",
			"/app/",
			"/app/$workspaceId",
			"/app/$workspaceId/",
		]);
	});
});
