import type { SpanKind } from "@repo/syntax";
import { Children, type ReactNode } from "react";
import { useLisptc } from "../lib/lisptc.ts";

const TONE: Record<SpanKind, string> = {
	plain: "",
	prose: "",
	delimiter: "text-dim",
	head: "text-blue",
	symbol: "text-fg",
	keyword: "text-aqua",
	number: "text-purple",
	string: "text-green",
};

export function LispText({ children }: { children: string }) {
	const lisptc = useLisptc();
	if (!lisptc) return children;
	return lisptc.read(children).spans.map((span) => (
		<span key={span.at} className={TONE[span.kind]}>
			{span.text}
		</span>
	));
}

export function withLisp(children: ReactNode): ReactNode {
	return Children.map(children, (child) =>
		typeof child === "string" ? <LispText>{child}</LispText> : child,
	);
}
