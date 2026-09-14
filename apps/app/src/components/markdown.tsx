import { highlighter } from "@repo/syntax";
import { createTanStackMarkdownHighlighter } from "@tanstack/highlight/markdown";
import { streamingMarkdownExtension } from "@tanstack/markdown/extensions/streaming";
import { Markdown as TanStackMarkdown } from "@tanstack/markdown/react";
import { createElement, type ReactNode } from "react";
import { withLisp } from "./lisp-text.tsx";

type TagProps = Record<string, unknown> & { children?: ReactNode };

const TEXT_TAGS = [
	"p",
	"li",
	"em",
	"strong",
	"blockquote",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
];

const CODE =
	"whitespace-pre-wrap break-words bg-transparent p-0 font-[inherit] text-[length:inherit]";

function tag(name: string, className?: string, lisp = false) {
	return ({ children, ...props }: TagProps) =>
		createElement(
			name,
			className === undefined ? props : { ...props, className },
			lisp ? withLisp(children) : children,
		);
}

const components = {
	...Object.fromEntries(
		TEXT_TAGS.map((name) => [name, tag(name, undefined, true)]),
	),
	a: ({ children, ...props }: TagProps) => (
		<a
			{...props}
			target="_blank"
			rel="noreferrer"
			className="break-all font-medium text-blue underline decoration-blue/40 underline-offset-2 hover:decoration-blue"
		>
			{children}
		</a>
	),
	code: ({ children, ...props }: TagProps) =>
		"dangerouslySetInnerHTML" in props
			? createElement("code", { ...props, className: CODE })
			: createElement(
					"code",
					{ ...props, className: CODE },
					withLisp(children),
				),
	pre: tag(
		"pre",
		"my-1 overflow-x-auto whitespace-pre-wrap break-words bg-transparent p-0 font-[inherit] text-[length:inherit]",
	),
	table: ({ children, ...props }: TagProps) => (
		<div className="my-2 overflow-x-auto">
			<table {...props} className="w-max min-w-full border-collapse text-left">
				{children}
			</table>
		</div>
	),
	thead: tag("thead", "border-bg2 border-b text-dim"),
	th: tag("th", "px-2 py-1 font-semibold", true),
	td: tag("td", "border-bg2/50 border-t px-2 py-1 align-top", true),
	hr: tag("hr", "my-2 border-bg2 border-t"),
};

const highlightCode = createTanStackMarkdownHighlighter(highlighter);
const extensions = [streamingMarkdownExtension()];

export function Markdown({ children }: { children: string }) {
	return (
		<div className="min-w-0 break-words font-[inherit] text-[length:inherit] text-inherit [&_:is(h1,h2,h3,h4,h5,h6)]:my-1 [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:text-[length:inherit] [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
			<TanStackMarkdown
				components={components}
				extensions={extensions}
				highlighter={highlightCode}
			>
				{children}
			</TanStackMarkdown>
		</div>
	);
}
