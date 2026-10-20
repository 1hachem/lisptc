import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval("expire the bin", { hours: 1 }, internal.bin.expire, {});

export default crons;
