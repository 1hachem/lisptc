import { useRef, useState } from "react";

export function searched<T extends { name: string }>(
	files: T[] | undefined,
	query: string,
): T[] | undefined {
	const needle = query.trim().toLowerCase();
	return needle === ""
		? files
		: files?.filter((file) => file.name.toLowerCase().includes(needle));
}

export function checkedAfter(
	order: readonly string[],
	picked: ReadonlySet<string>,
	anchor: string | null,
	name: string,
	range: boolean,
): Set<string> {
	const next = new Set(picked);
	const from = anchor === null ? -1 : order.indexOf(anchor);
	const to = order.indexOf(name);
	if (range && from !== -1 && to !== -1) {
		for (const between of order.slice(
			Math.min(from, to),
			Math.max(from, to) + 1,
		))
			next.add(between);
		return next;
	}
	if (next.has(name)) next.delete(name);
	else next.add(name);
	return next;
}

export function toggledAll(
	picked: ReadonlySet<string>,
	names: readonly string[],
): Set<string> {
	const next = new Set(picked);
	const every = names.every((name) => picked.has(name));
	for (const name of names) {
		if (every) next.delete(name);
		else next.add(name);
	}
	return next;
}

export function useSelection(order: readonly string[] | undefined) {
	const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
	const anchor = useRef<string | null>(null);
	const present = order ?? [];
	const selected = present.filter((name) => picked.has(name));

	return {
		selected,
		check: (name: string) => ({
			checked: picked.has(name),
			selecting: selected.length > 0,
			onCheck: (range: boolean) => {
				setPicked(checkedAfter(present, picked, anchor.current, name, range));
				anchor.current = name;
			},
		}),
		among: (names: readonly string[]) => ({
			checked: names.length > 0 && names.every((name) => picked.has(name)),
			selecting: selected.length > 0,
			onCheck: () => setPicked(toggledAll(picked, names)),
		}),
		all: () => setPicked(new Set(present)),
		clear: () => {
			anchor.current = null;
			setPicked(new Set());
		},
	};
}

export async function eachOf(
	names: readonly string[],
	work: (name: string) => Promise<unknown>,
): Promise<void> {
	const failed: string[] = [];
	for (const name of names) {
		try {
			await work(name);
		} catch (ex) {
			failed.push(`${name}: ${ex instanceof Error ? ex.message : String(ex)}`);
		}
	}
	if (failed.length > 0)
		throw new Error(
			`${failed.length} of ${names.length} failed. ${failed.join("; ")}`,
		);
}

const REVOKE_AFTER_MS = 1_000;

export async function saveAs(name: string, url: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`download answered ${response.status}`);
	const bytes = await response.arrayBuffer();
	const href = URL.createObjectURL(
		new Blob([bytes], { type: "application/octet-stream" }),
	);
	const link = document.createElement("a");
	link.href = href;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(href), REVOKE_AFTER_MS);
}
