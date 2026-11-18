import { str } from "@repo/interpreter/print";
import { Reader } from "@repo/interpreter/reader";
import type {
	Onboarded,
	Onboarding,
	OnboardingStatus,
	OnboardingStore,
	Progress,
} from "@repo/onboarding-extension/ports";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

interface StoredOnboarding {
	name: string;
	about: string;
	script: string;
	status: OnboardingStatus;
}

function readForm(text: string): unknown {
	const reader = new Reader();
	reader.push(text);
	return reader.read();
}

function decodeOnboarding(row: StoredOnboarding): Onboarded {
	return {
		name: row.name,
		about: row.about,
		script: readForm(row.script),
		status: row.status,
	};
}

export type OnboardingClient = Pick<ConvexHttpClient, "query" | "mutation">;

export class ConvexOnboardingStore implements OnboardingStore {
	constructor(
		private readonly workspaceId: Id<"workspaces">,
		private readonly connect: () => OnboardingClient,
	) {}

	async all(): Promise<Onboarded[]> {
		const rows = await this.connect().query(api.onboardings.list, {
			workspaceId: this.workspaceId,
		});
		return rows.map(decodeOnboarding);
	}

	async get(name: string): Promise<Onboarded | undefined> {
		const row = await this.connect().query(api.onboardings.get, {
			workspaceId: this.workspaceId,
			name,
		});
		return row === null ? undefined : decodeOnboarding(row);
	}

	async put({ name, about, script }: Onboarding): Promise<void> {
		await this.connect().mutation(api.onboardings.put, {
			workspaceId: this.workspaceId,
			onboarding: { name, about, script: str(script) },
		});
	}

	async mark(name: string, status: Progress): Promise<void> {
		await this.connect().mutation(api.onboardings.mark, {
			workspaceId: this.workspaceId,
			name,
			status,
		});
	}
}
