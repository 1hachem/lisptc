// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { SourceValue } from "../src/components/read-only.tsx";

beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

function rendered(node: ReactNode): HTMLElement {
	const host = document.createElement("div");
	act(() => createRoot(host).render(node));
	return host;
}

describe("a stored value", () => {
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
