import { highlighter } from "@repo/syntax";
import { Children, type ReactNode } from "react";

export function LispText({ children }: { children: string }) {
	let at = 0;
	return highlighter.tokenize(children, { lang: "lisptc" }).tokens.map((t) => {
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
