import { EvalException } from "@repo/interpreter/errors";
import { isFileName, sanitizeFileName } from "@repo/shared/files";

export function anyName(value: unknown): string {
	if (typeof value !== "string" || value.trim() === "")
		throw new EvalException("a file name must be a non-empty string", value);
	return value.trim();
}

export function fileName(value: unknown): string {
	const name = anyName(value);
	if (isFileName(name)) return name;
	const safe = sanitizeFileName(name);
	throw new EvalException(
		safe === null
			? `${JSON.stringify(name)} is not a file name: no slash, control character or leading dot, at most 128 characters`
			: `${JSON.stringify(name)} is not a file name; use ${JSON.stringify(safe)}`,
		value,
	);
}

export function fetchedUrl(value: unknown): URL {
	let url: URL | undefined;
	try {
		url = typeof value === "string" ? new URL(value) : undefined;
	} catch {
		url = undefined;
	}
	if (
		url === undefined ||
		(url.protocol !== "https:" && url.protocol !== "http:")
	)
		throw new EvalException("an http or https url expected", value);
	return url;
}

function decoded(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

export function nameFromUrl(url: URL): string {
	const last = decoded(url.pathname.split("/").pop() ?? "");
	return sanitizeFileName(last) ?? sanitizeFileName(url.hostname) ?? "download";
}
