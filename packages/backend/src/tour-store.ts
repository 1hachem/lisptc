import type { StartedTour, TourStore } from "@repo/ui-extension";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export type TourClient = Pick<ConvexHttpClient, "mutation" | "query">;

export class ConvexTourStore implements TourStore {
	constructor(
		private readonly chatId: Id<"chats">,
		private readonly connect: () => TourClient,
	) {}

	async start(tour: StartedTour): Promise<void> {
		await this.connect().mutation(api.tours.start, {
			chatId: this.chatId,
			...tour,
		});
	}

	async finished(tourId: string): Promise<boolean> {
		return await this.connect().query(api.tours.finished, { tourId });
	}
}
