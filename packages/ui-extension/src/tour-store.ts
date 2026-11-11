import type { Awaitable } from "@repo/shared/host";
import type { Pointer, TourLabels, TourStep } from "@repo/ui-catalog";

export interface StartedTour {
	tourId: string;
	steps: TourStep[];
	labels?: TourLabels;
	done?: string;
	skip?: string;
}

export interface TourStore {
	start(tour: StartedTour): Awaitable<void>;
	point(pointer: Pointer): Awaitable<void>;
	finished(tourId: string): Awaitable<boolean>;
}

export class MemoryTourStore implements TourStore {
	readonly tours = new Map<string, StartedTour>();
	readonly pointers: Pointer[] = [];
	readonly done = new Set<string>();

	start(tour: StartedTour): void {
		this.tours.set(tour.tourId, tour);
	}

	point(pointer: Pointer): void {
		this.pointers.push(pointer);
	}

	finished(tourId: string): boolean {
		return this.done.has(tourId);
	}
}
