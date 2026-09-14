import { reportSchema } from "./report.ts";
import { clearParts, mergeShards, REPORT_DIR, reportName } from "./shards.ts";
import { localStore, reportStore } from "./storage.ts";

export function setup(): void {
	clearParts();
}

export async function teardown(): Promise<void> {
	const report = mergeShards();
	if (!report) return;
	const name = reportName(report);
	const body = `${JSON.stringify(reportSchema.parse(report), null, 2)}\n`;
	const store = reportStore();
	try {
		await store.write(name, body);
		console.log(`[evals] report written to ${store.describe()}${name}`);
	} catch (err) {
		await localStore(REPORT_DIR).write(name, body);
		console.error(
			`[evals] could not write to ${store.describe()} — the report is at ${REPORT_DIR}/${name}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	clearParts();
}
