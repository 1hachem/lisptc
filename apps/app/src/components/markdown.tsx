import { createElement, type ReactNode } from "react";
import { type Components, Streamdown } from "streamdown";
import "streamdown/styles.css";
import { withLisp } from "./lisp-text.tsx";

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
	"td",
	"th",
];

function highlighted(tag: string) {
	return ({
		children,
		...props
	}: Record<string, unknown> & { children?: ReactNode }) =>
		createElement(tag, props, withLisp(children));
}

const components: Components = {
	...Object.fromEntries(TEXT_TAGS.map((tag) => [tag, highlighted(tag)])),
	a: ({ children, ...props }) => (
		<a
			{...props}
			target="_blank"
			rel="noreferrer"
			className="break-all font-medium text-blue underline decoration-blue/40 underline-offset-2 hover:decoration-blue"
		>
			{children}
		</a>
	),
	code: ({ children, ...props }) => (
		<code
			{...props}
			className="whitespace-pre-wrap break-words bg-transparent p-0 font-[inherit] text-[length:inherit]"
		>
			{withLisp(children)}
		</code>
	),
	pre: ({ children, ...props }) => (
		<pre
			{...props}
			className="my-1 overflow-x-auto whitespace-pre-wrap break-words bg-transparent p-0 font-[inherit] text-[length:inherit]"
		>
			{children}
		</pre>
	),
};

export function Markdown({ children }: { children: string }) {
	return (
		<Streamdown
			components={components}
			className="min-w-0 break-words font-[inherit] text-[length:inherit] text-inherit [&_:is(h1,h2,h3,h4,h5,h6)]:my-1 [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:text-[length:inherit] [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
		>
			{children}
		</Streamdown>
	);
}
