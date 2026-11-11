import { readFileSync } from "node:fs";
import { containerOf, remoteSpecFor } from "@repo/mcp-extension/kubernetes";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { server } from "./helpers.ts";

const CRD = new URL(
	"../../../charts/lisptc/crds/mcpservers.lisptc.io.yaml",
	import.meta.url,
);

function specSchema() {
	const crd = parse(readFileSync(CRD, "utf8"));
	return crd.spec.versions[0].schema.openAPIV3Schema.properties.spec;
}

describe("the McpServer CRD", () => {
	const validate = new Ajv({ strict: false }).compile(specSchema());

	it("accepts the spec the host writes for a pair", () => {
		const valid = validate(server().spec);
		expect(validate.errors ?? []).toEqual([]);
		expect(valid).toBe(true);
	});

	it("accepts the spec the host writes for a remote server", () => {
		const spec = remoteSpecFor(
			{ name: "remote", url: "https://mcp.example.com/mcp" },
			"ws1",
			1000,
		);
		expect(validate(spec)).toBe(true);
	});

	it("rejects a remote server whose url is not http", () => {
		const spec = remoteSpecFor(
			{ name: "remote", url: "https://mcp.example.com/mcp" },
			"ws1",
			1000,
		);
		expect(validate({ ...spec, remote: { url: "file:///etc/passwd" } })).toBe(
			false,
		);
	});

	it("accepts a server without an app", () => {
		expect(
			validate(server({ name: "fs", image: "fs-mcp", port: 8000 }).spec),
		).toBe(true);
	});

	it("accepts a server that names a secret", () => {
		const spec = server({
			name: "ocr",
			image: "ocr-mcp",
			port: 8000,
			secret: { name: "lisptc-mcp-ocr", keys: ["MISTRAL_API_KEY"] },
		}).spec;
		expect(spec.mcp?.secret).toBe("lisptc-mcp-ocr");
		expect(validate(spec)).toBe(true);
	});

	it("rejects a secret that is not a valid name", () => {
		const spec = structuredClone(server().spec);
		spec.mcp = { ...containerOf(spec), secret: "Not A Name" };
		expect(validate(spec)).toBe(false);
	});
});
