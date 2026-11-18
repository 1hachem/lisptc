import { describe, expect, it } from "vitest";
import {
	ConvexPermissionsStore,
	type PermissionsClient,
} from "../src/permissions-store.ts";
import { signIn, testDeployment } from "./helpers.ts";

async function workspace() {
	const alice = await signIn(testDeployment(), "alice@example.com");
	const connect = () => alice.as as unknown as PermissionsClient;
	return () => ConvexPermissionsStore.open(alice.workspace, connect);
}

describe("the convex permissions store", () => {
	it("serves an empty config to a workspace that never saved one", async () => {
		const open = await workspace();
		expect((await open()).source()).toBe("");
	});
});
