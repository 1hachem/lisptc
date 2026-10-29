import type { Awaitable } from "@repo/shared/host";
import type { TourStep } from "@repo/ui-catalog";

export interface StartedTour {
	tourId: string;
	steps: TourStep[];
	done?: string;
	skip?: string;
}

export interface TourStore {
	start(tour: StartedTour): Awaitable<void>;
	finished(tourId: string): Awaitable<boolean>;
}

export class MemoryTourStore implements TourStore {
	readonly tours = new Map<string, StartedTour>();
	readonly done = new Set<string>();

	start(tour: StartedTour): void {
		this.tours.set(tour.tourId, tour);
	}

	finished(tourId: string): boolean {
		return this.done.has(tourId);
	}
}
