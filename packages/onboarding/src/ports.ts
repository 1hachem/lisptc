import type { Awaitable, PromptSource } from "@repo/shared/host";

export const PROGRESS = ["started", "done"] as const;
export type Progress = (typeof PROGRESS)[number];
export type OnboardingStatus = "new" | Progress;

export interface Onboarding {
	name: string;
	about: string;
	script: unknown;
}

export interface Onboarded extends Onboarding {
	status: OnboardingStatus;
}

export interface OnboardingStore {
	all(): Awaitable<Onboarded[]>;
	get(name: string): Awaitable<Onboarded | undefined>;
	put(onboarding: Onboarding): Awaitable<void>;
	mark(name: string, progress: Progress): Awaitable<void>;
}

export interface OnboardingHost {
	store: OnboardingStore;
	prompt: PromptSource;
}

export class VolatileOnboardingStore implements OnboardingStore {
	readonly onboardings = new Map<string, Onboarding>();
	readonly progress = new Map<string, Progress>();

	all(): Onboarded[] {
		return [...this.onboardings.keys()].flatMap((name) => {
			const found = this.get(name);
			return found === undefined ? [] : [found];
		});
	}

	get(name: string): Onboarded | undefined {
		const onboarding = this.onboardings.get(name);
		if (onboarding === undefined) return undefined;
		return { ...onboarding, status: this.progress.get(name) ?? "new" };
	}

	put(onboarding: Onboarding): void {
		this.onboardings.set(onboarding.name, onboarding);
	}

	mark(name: string, progress: Progress): void {
		this.progress.set(name, progress);
	}
}
