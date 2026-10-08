// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	type ModelChoice,
	type ProviderOption,
	WorkspaceModelDialog,
	WorkspaceModelSelector,
} from "./workspace-model-selector.tsx";

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	Element.prototype.scrollIntoView ??= () => {};
});

const providers: ProviderOption[] = [
	{
		id: "openrouter",
		name: "OpenRouter",
		logo: "openrouter",
		models: [
			{ id: "google/gemma-4-31b-it", name: "Gemma 4 31B" },
			{ id: "moonshotai/kimi-k3", name: "Kimi K3" },
		],
	},
	{
		id: "digitalocean",
		name: "DigitalOcean",
		models: [{ id: "gemma-4-31b-it", name: "Gemma 4 31B" }],
	},
];

async function mounted(value: ModelChoice) {
	const onSelect = vi.fn();
	const host = document.createElement("div");
	document.body.append(host);
	await act(async () => {
		createRoot(host).render(
			<WorkspaceModelSelector
				onSelect={onSelect}
				providers={providers}
				value={value}
				workspace="lab"
			/>,
		);
	});
	const trigger = () => host.querySelector<HTMLButtonElement>("button");
	return {
		onSelect,
		trigger,
		async open() {
			await act(async () => {
				trigger()?.dispatchEvent(
					new PointerEvent("pointerdown", { bubbles: true }),
				);
				trigger()?.click();
			});
		},
		item: (value: string) =>
			document.querySelector<HTMLElement>(`[data-value="${value}"]`),
		async pick(value: string) {
			await act(async () => {
				document.querySelector<HTMLElement>(`[data-value="${value}"]`)?.click();
			});
		},
	};
}

describe("choosing the model a workspace runs on", () => {
	it("names the current model on the trigger", async () => {
		const ui = await mounted({
			provider: "openrouter",
			model: "google/gemma-4-31b-it",
		});
		expect(ui.trigger()?.textContent).toContain("Gemma 4 31B");
	});

	it("falls back to the raw id when the model is not offered", async () => {
		const ui = await mounted({ provider: "openrouter", model: "retired/x" });
		expect(ui.trigger()?.textContent).toContain("retired/x");
	});

	it("tells two providers' models of the same name apart", async () => {
		const ui = await mounted({
			provider: "openrouter",
			model: "google/gemma-4-31b-it",
		});
		await ui.open();
		await ui.pick("digitalocean/gemma-4-31b-it");
		expect(ui.onSelect).toHaveBeenCalledWith({
			provider: "digitalocean",
			model: "gemma-4-31b-it",
		});
	});

	it("marks the current choice and does not resend it", async () => {
		const ui = await mounted({
			provider: "openrouter",
			model: "google/gemma-4-31b-it",
		});
		await ui.open();
		expect(ui.item("openrouter/google/gemma-4-31b-it")?.dataset.chosen).toBe(
			"true",
		);
		await ui.pick("openrouter/google/gemma-4-31b-it");
		expect(ui.onSelect).not.toHaveBeenCalled();
	});
});

describe("choosing a model from a dialog opened elsewhere", () => {
	it("opens with no trigger of its own and closes on a pick", async () => {
		const onSelect = vi.fn();
		const onOpenChange = vi.fn();
		const host = document.createElement("div");
		document.body.append(host);
		await act(async () => {
			createRoot(host).render(
				<WorkspaceModelDialog
					onOpenChange={onOpenChange}
					onSelect={onSelect}
					open
					providers={providers}
					value={{ provider: "openrouter", model: "google/gemma-4-31b-it" }}
					workspace="lab"
				/>,
			);
		});
		expect(host.querySelector("button")).toBeNull();
		await act(async () => {
			document
				.querySelector<HTMLElement>(
					'[data-value="openrouter/moonshotai/kimi-k3"]',
				)
				?.click();
		});
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onSelect).toHaveBeenCalledWith({
			provider: "openrouter",
			model: "moonshotai/kimi-k3",
		});
	});
});
