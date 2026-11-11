// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { RuleCard, SourceValue } from "../src/components/read-only.tsx";

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

function rendered(node: ReactNode): HTMLElement {
	const host = document.createElement("div");
	act(() => createRoot(host).render(node));
	return host;
}

describe("a permission rule", () => {
	it("names its effect in words and lists what it covers, with no parens", () => {
		const host = rendered(
			<RuleCard source="(permission/deny eval fs/write)" />,
		);
		expect(host.textContent).toContain("deny");
		expect(host.textContent).toContain("always refused");
		expect(host.textContent).toContain("eval");
		expect(host.textContent).toContain("fs/write");
		expect(host.textContent).not.toContain("(");
	});

	it("shows a server's tool list under its label", () => {
		const host = rendered(
			<RuleCard source="(permission/server playwright (only browser_navigate))" />,
		);
		expect(host.textContent).toContain("only");
		expect(host.textContent).toContain("browser_navigate");
		expect(host.textContent).not.toContain("(");
	});
});

describe("a stored value", () => {
	it("shows a string as its text, without the quotes", () => {
		const host = rendered(<SourceValue source={'"be brief"'} />);
		expect(host.textContent).toBe("be brief");
	});

	it("shows a plist as its labels and values, without the keyword colons", () => {
		const host = rendered(
			<SourceValue source={'(:tone "brief" :lang "en")'} />,
		);
		expect(host.textContent).toContain("tone");
		expect(host.textContent).toContain("brief");
		expect(host.textContent).toContain("lang");
		expect(host.textContent).not.toContain(":");
	});
});
