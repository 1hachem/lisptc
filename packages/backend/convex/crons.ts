import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
	"move week-old attachments to the bin",
	{ hours: 24 },
	internal.attachments.expire,
	{},
);

crons.interval(
	"empty month-old files from the bin",
	{ hours: 24 },
	internal.bin.empty,
	{},
);

export default crons;
