import { type Lisptc, loadLisptc } from "@repo/syntax";
import grammarUrl from "@repo/syntax/lisptc.wasm?url";
import { useEffect, useState } from "react";
import runtime from "web-tree-sitter/tree-sitter.wasm?url";

let loading: Promise<Lisptc> | undefined;

async function load(): Promise<Lisptc> {
	const grammar = await fetch(grammarUrl).then((r) => r.arrayBuffer());
	return loadLisptc({ grammar: new Uint8Array(grammar), runtime });
}

function lisptc(): Promise<Lisptc> {
	loading ??= load();
	return loading;
}

export function useLisptc(): Lisptc | null {
	const [reader, setReader] = useState<Lisptc | null>(null);
	useEffect(() => {
		let live = true;
		lisptc().then(
			(ready) => {
				if (live) setReader(ready);
			},
			(error: unknown) => {
				console.error("[lisptc] the grammar failed to load:", error);
			},
		);
		return () => {
			live = false;
		};
	}, []);
	return reader;
}
