import { tokensIn } from "@repo/syntax";
import { Children, createContext, type ReactNode, useContext } from "react";

const Skipped = createContext<readonly string[]>([]);

export function SkippedProse({
	heads,
	children,
}: {
	heads: readonly string[];
	children: ReactNode;
}) {
	return <Skipped.Provider value={heads}>{children}</Skipped.Provider>;
}

export function LispText({ children }: { children: string }) {
	const skipped = useContext(Skipped);
	let at = 0;
	return tokensIn(children, skipped).map((t) => {
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
