// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { TourCallout } from "../src/components/tour-callout.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

function shown(props: Partial<Parameters<typeof TourCallout>[0]>) {
	const host = document.createElement("div");
	const root = createRoot(host);
	act(() =>
		root.render(
			<TourCallout
				step={{ say: "hello", until: "next" }}
				at={0}
				count={2}
				element={undefined}
				gaveUp={false}
				onNext={() => {}}
				onSkip={() => {}}
				{...props}
			/>,
		),
	);
	const dialog = document.querySelector('[aria-label="tour"]');
	return { dialog, close: () => act(() => root.unmount()) };
}

describe("the tour callout", () => {
	it("centres a step with no anchor and offers next", () => {
		const { dialog, close } = shown({});
		expect(dialog?.getAttribute("data-side")).toBe("center");
		expect(dialog?.textContent).toContain("next");
		close();
	});

	it("waits for a missing anchor, then gives a centred next", () => {
		const step = { anchor: "composer", say: "type", until: "click" as const };
		const waiting = shown({ step });
		expect(waiting.dialog).toBeNull();
		waiting.close();
		const { dialog, close } = shown({ step, gaveUp: true, at: 1 });
		expect(dialog?.getAttribute("data-side")).toBe("center");
		expect(dialog?.textContent).toContain("done");
		close();
	});
});
