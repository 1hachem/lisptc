import { backgroundJobsContract } from "./contract.ts";
import { InProcessJobs } from "./helpers.ts";

backgroundJobsContract("an in-process fake", async () => ({
	jobs: new InProcessJobs(),
	parent: "root",
}));
