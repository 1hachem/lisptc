// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
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

function Workspace({ initial }: { initial: ModelChoice }) {
	const [value, setValue] = useState(initial);
	return (
		<WorkspaceModelSelector
			onSelect={setValue}
			providers={providers}
			value={value}
			workspace="lab"
		/>
	);
}

async function mounted(value: ModelChoice) {
	const host = document.createElement("div");
	document.body.append(host);
	await act(async () => {
		createRoot(host).render(<Workspace initial={value} />);
	});
	const trigger = () => host.querySelector<HTMLButtonElement>("button");
	return {
		trigger,
		async open() {
			await act(async () => {
				trigger()?.dispatchEvent(
					new PointerEvent("pointerdown", { bubbles: true }),
				);
				trigger()?.click();
			});
		},
		async pick(value: string) {
			await act(async () => {
				document.querySelector<HTMLElement>(`[data-value="${value}"]`)?.click();
			});
		},
	};
}

describe("choosing the model a workspace runs on", () => {
	it("falls back to the raw id when the model is not offered", async () => {
		const ui = await mounted({ provider: "openrouter", model: "retired/x" });
		expect(ui.trigger()?.textContent).toContain("retired/x");
	});

	it("tells two providers' models of the same name apart", async () => {
		const ui = await mounted({
			provider: "openrouter",
			model: "google/gemma-4-31b-it",
		});
		expect(
			ui.trigger()?.querySelector('img[alt="openrouter logo"]'),
		).not.toBeNull();
		await ui.open();
		await ui.pick("digitalocean/gemma-4-31b-it");
		expect(ui.trigger()?.textContent).toContain("Gemma 4 31B");
		expect(
			ui.trigger()?.querySelector('img[alt="openrouter logo"]'),
		).toBeNull();
	});
});

function Elsewhere() {
	const [open, setOpen] = useState(true);
	const [value, setValue] = useState<ModelChoice>({
		provider: "openrouter",
		model: "google/gemma-4-31b-it",
	});
	return (
		<>
			<output>{value.model}</output>
			<WorkspaceModelDialog
				onOpenChange={setOpen}
				onSelect={setValue}
				open={open}
				providers={providers}
				value={value}
				workspace="lab"
			/>
		</>
	);
}

describe("choosing a model from a dialog opened elsewhere", () => {
	it("opens with no trigger of its own and closes on a pick", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		await act(async () => {
			createRoot(host).render(<Elsewhere />);
		});
		expect(host.querySelector("button")).toBeNull();
		await act(async () => {
			[...document.querySelectorAll<HTMLElement>("[cmdk-item]")]
				.find((item) => item.textContent?.includes("Kimi K3"))
				?.click();
		});
		expect(host.querySelector("output")?.textContent).toBe(
			"moonshotai/kimi-k3",
		);
		expect(document.querySelector("[cmdk-item]")).toBeNull();
	});
});
