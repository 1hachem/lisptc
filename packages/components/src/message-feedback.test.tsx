// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MessageFeedback } from "./message-feedback.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

const mounts: { root: Root; host: HTMLElement }[] = [];

afterEach(async () => {
	for (const { root, host } of mounts.splice(0)) {
		await act(async () => root.unmount());
		host.remove();
	}
});

async function mounted() {
	const capture = vi.fn();
	const onRate = vi.fn();
	const onThank = vi.fn();
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	mounts.push({ root, host });
	await act(async () => {
		root.render(
			<StrictMode>
				<MessageFeedback capture={capture} onRate={onRate} onThank={onThank} />
			</StrictMode>,
		);
	});

	return {
		capture,
		onRate,
		onThank,
		field: () =>
			document.querySelector<HTMLInputElement>("[role=dialog] input"),
		async vote(title: string) {
			await act(async () => {
				host
					.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
					?.click();
			});
		},
		async explain(text: string) {
			const input = document.querySelector("[role=dialog] input");
			if (!input) throw new Error("no follow-up input");
			await act(async () => {
				Object.getOwnPropertyDescriptor(
					HTMLInputElement.prototype,
					"value",
				)?.set?.call(input, text);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			});
			await act(async () => {
				input.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
				);
			});
		},
	};
}

describe("voting on an agent message", () => {
	it("sends the thumb on the click, before any sentence is typed", async () => {
		const ui = await mounted();
		await ui.vote("helpful");

		expect(ui.onRate).toHaveBeenCalledWith("up");
		expect(ui.capture).toHaveBeenCalledTimes(1);
		expect(ui.capture.mock.calls[0][0]).toMatchObject({
			$survey_response: 1,
			$survey_completed: true,
		});
		expect(ui.field()).not.toBeNull();
	});

	it("sends the sentence under the same submission, repeating the thumb", async () => {
		const ui = await mounted();
		await ui.vote("not helpful");
		await ui.explain("it looped on the same tool");

		expect(ui.capture).toHaveBeenCalledTimes(2);
		const [first, second] = ui.capture.mock.calls.map((call) => call[0]);
		expect(second).toMatchObject({
			$survey_response: 2,
			$survey_response_1: "it looped on the same tool",
			$survey_completed: true,
		});
		expect(second.$survey_submission_id).toBe(first.$survey_submission_id);
		expect(ui.field()).toBeNull();
		expect(ui.onThank).toHaveBeenCalledTimes(1);
	});

	it("keeps an empty sentence from sending a second event", async () => {
		const ui = await mounted();
		await ui.vote("helpful");
		await ui.explain("   ");

		expect(ui.capture).toHaveBeenCalledTimes(1);
		expect(ui.field()).not.toBeNull();
		expect(ui.onThank).not.toHaveBeenCalled();
	});
});
