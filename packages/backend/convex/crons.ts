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

crons.interval(
	"free day-old uploads no file claimed",
	{ hours: 24 },
	internal.uploads.sweep,
	{},
);

export default crons;
