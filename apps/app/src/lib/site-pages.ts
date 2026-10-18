import { dataToJson } from "@repo/interpreter/objects";
import { Reader } from "@repo/interpreter/reader";
import {
	type LandingPage,
	type LandingResult,
	parseLandingPage,
} from "@repo/landing";
import salsal from "../site/salsal.ptc?raw";

export function readLandingSource(source: string): LandingResult {
	try {
		const reader = new Reader();
		reader.push(source);
		return parseLandingPage(dataToJson(reader.read()));
	} catch (ex) {
		return {
			ok: false,
			problems: [ex instanceof Error ? ex.message : String(ex)],
		};
	}
}

export const MAIN_VERTICAL = "salsal";

const builtIn: Readonly<Record<string, string>> = { [MAIN_VERTICAL]: salsal };

export function builtInPage(vertical: string): LandingPage | undefined {
	const source = builtIn[vertical];
	if (source === undefined) return undefined;
	const read = readLandingSource(source);
	if (!read.ok)
		throw new Error(`built-in page ${vertical}: ${read.problems.join("; ")}`);
	return read.page;
}

export function startHref(): string {
	return "/app/login";
}
