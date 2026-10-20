import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval(
	"expire the attachments",
	{ hours: 1 },
	internal.attachments.expire,
	{},
);

export default crons;
