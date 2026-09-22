import { type FormSpan, tokensIn } from "@repo/syntax";
import {
	Children,
	createContext,
	type ReactNode,
	useContext,
	useMemo,
} from "react";

interface Skips {
	readonly text: string;
	readonly spans: readonly FormSpan[];
}

const Skipped = createContext<Skips>({ text: "", spans: [] });

export function SkippedProse({
	text,
	spans,
	children,
}: {
	text: string;
	spans: readonly FormSpan[];
	children: ReactNode;
}) {
	const value = useMemo(() => ({ text, spans }), [text, spans]);
	return <Skipped.Provider value={value}>{children}</Skipped.Provider>;
}

function spansOver(fragment: string, { text, spans }: Skips): FormSpan[] {
	if (spans.length === 0) return [];
	const at = text.indexOf(fragment);
	if (at < 0) return [];
	return spans.map(([from, to]) => [from - at, to - at]);
}

export function LispText({ children }: { children: string }) {
	const skipped = useContext(Skipped);
	let at = 0;
	return tokensIn(children, spansOver(children, skipped)).map((t) => {
		const key = at;
		at += t.value.length;
		return (
			<span key={key} className={t.className && `th-${t.className}`}>
				{t.value}
			</span>
		);
	});
}

export function withLisp(children: ReactNode): ReactNode {
	return Children.map(children, (child) =>
		typeof child === "string" ? <LispText>{child}</LispText> : child,
	);
}
