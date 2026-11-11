import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerRunner } from "../src/docker.ts";
import { DockerUnavailable } from "../src/docker-trouble.ts";
import { runSpecFor } from "../src/launch.ts";

const spec = runSpecFor({ name: "browser", image: "browser-mcp", port: 8931 });

function pathWith(docker?: string): string {
	const dir = mkdtempSync(join(tmpdir(), "docker-stub-"));
	if (docker !== undefined) {
		const file = join(dir, "docker");
		writeFileSync(file, docker);
		chmodSync(file, 0o755);
	}
	return dir;
}

async function trouble(): Promise<unknown> {
	return await new DockerRunner().run(spec, () => {}).catch((ex) => ex);
}

describe("a machine docker cannot serve", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("refuses to run when no docker command can be found", async () => {
		vi.stubEnv("PATH", pathWith());

		const refused = await trouble();

		expect(refused).toBeInstanceOf(DockerUnavailable);
		expect(refused).toMatchObject({ server: "browser", trouble: "missing" });
	});

	it("refuses to run when docker is installed but its engine does not answer", async () => {
		vi.stubEnv("PATH", pathWith("#!/bin/sh\nexit 1\n"));

		const refused = await trouble();

		expect(refused).toBeInstanceOf(DockerUnavailable);
		expect(refused).toMatchObject({ server: "browser", trouble: "stopped" });
	});

	it("tells a machine how to get docker for the platform it runs on", () => {
		const mac = new DockerUnavailable("browser", "missing", "darwin").message;
		const linux = new DockerUnavailable("browser", "missing", "linux").message;

		expect(mac).not.toBe(linux);
	});
});
