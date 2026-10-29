import type { AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { landInApp, preloadAppChunks } from "../src/lib/land.ts";

describe("landing in the app after sign in", () => {
	it("loads the app as a full page so the server renders it with its data", () => {
		const replace = vi.fn();
		landInApp({ replace });
		expect(replace).toHaveBeenCalledWith("/");
	});

	it("fetches the workspace chunks while auth is still in flight", () => {
		const loaded: string[] = [];
		const route = (id: string) => ({ id });
		const router = {
			routesById: {
				"/_authed": route("/_authed"),
				"/_authed/": route("/_authed/"),
				"/_authed/$workspaceId": route("/_authed/$workspaceId"),
				"/_authed/$workspaceId/": route("/_authed/$workspaceId/"),
				"/login": route("/login"),
			},
			loadRouteChunk: (r: { id: string }) => {
				loaded.push(r.id);
				return Promise.resolve();
			},
		} as unknown as AnyRouter;
		preloadAppChunks(router, "now");
		expect(loaded).toEqual([
			"/_authed",
			"/_authed/",
			"/_authed/$workspaceId",
			"/_authed/$workspaceId/",
		]);
	});
});
