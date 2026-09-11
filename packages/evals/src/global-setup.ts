import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reportSchema } from "./report.ts";
import { clearParts, mergeShards, REPORT_DIR, reportName } from "./shards.ts";

export function setup(): void {
	clearParts();
}

export function teardown(): void {
	const report = mergeShards();
	if (!report) return;
	mkdirSync(REPORT_DIR, { recursive: true });
	writeFileSync(
		join(REPORT_DIR, reportName(report)),
		`${JSON.stringify(reportSchema.parse(report), null, 2)}\n`,
	);
	clearParts();
}
