import { imagesOf } from "@repo/mcp-extension/kubernetes";
import toolkit from "@repo/mcp-extension/mcp.toolkit.json" with {
	type: "json",
};
import type { ConnConfig } from "@repo/mcp-extension/ports";

export function toolkitImages(
	tag?: string,
	entries: readonly unknown[] = toolkit,
): string[] {
	return [
		...new Set(
			(entries as ConnConfig[]).flatMap((conf) => imagesOf(conf, tag)),
		),
	];
}
