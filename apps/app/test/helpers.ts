import type { AnyRequestMiddleware } from "@tanstack/react-start";

type Context = Record<string, unknown>;

interface Served {
	request: Request;
	pathname: string;
	context: Context;
	response: Response;
}

export interface Method {
	middleware: readonly AnyRequestMiddleware[];
	// biome-ignore lint/suspicious/noExplicitAny: each route types its own context
	handler: (ctx: any) => Response | Promise<Response>;
}

type Step = (options: {
	request: Request;
	pathname: string;
	context: Context;
	next: (options?: { context?: Context }) => Promise<Served>;
	handlerType: "router";
}) => Served | Response | Promise<Served | Response>;

export function serve(method: Method): (request: Request) => Promise<Response> {
	return async (request) => {
		const pathname = new URL(request.url).pathname;
		const run = async (index: number, context: Context): Promise<Served> => {
			const next = (options?: { context?: Context }) =>
				run(index + 1, { ...context, ...options?.context });
			const step = method.middleware[index]?.options.server as Step | undefined;
			if (step === undefined) {
				const response = await method.handler({ request, pathname, context });
				return { request, pathname, context, response };
			}
			const result = await step({
				request,
				pathname,
				context,
				next,
				handlerType: "router",
			});
			return result instanceof Response
				? { request, pathname, context, response: result }
				: result;
		};
		return (await run(0, {})).response;
	};
}

export function post(
	method: Method,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	return serve(method)(
		new Request("http://app.test/", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		}),
	);
}

const UNBROKEN = /\S{40,}/;

const WRAPS = ["break-words", "break-all", "wrap-anywhere", "wrap-break-word"];

const KEEPS_ONE_LINE = ["whitespace-nowrap", "whitespace-pre"];

const CLIPS = [
	"overflow-hidden",
	"overflow-clip",
	"overflow-x-hidden",
	"overflow-x-clip",
];

function classesOf(element: Element | null): Set<string> {
	return new Set((element?.getAttribute("class") ?? "").split(/\s+/));
}

function named(element: Element): string {
	return `<${element.tagName.toLowerCase()} class="${element.getAttribute("class") ?? ""}">`;
}

function ends(classes: Set<string>): boolean {
	return (
		classes.has("truncate") ||
		[...classes].some((name) => name.startsWith("line-clamp-"))
	);
}

function laidInARow(parent: Set<string>): boolean {
	return (
		((parent.has("flex") || parent.has("inline-flex")) &&
			!parent.has("flex-col")) ||
		parent.has("grid") ||
		parent.has("inline-grid")
	);
}

const WRAPS_ANYWHERE = ["break-all", "wrap-anywhere"];

const SCROLLS_SIDEWAYS = [
	"overflow-auto",
	"overflow-scroll",
	"overflow-x-auto",
	"overflow-x-scroll",
];

const WRAPS_LINES = [
	"whitespace-normal",
	"whitespace-pre-wrap",
	"whitespace-pre-line",
	"whitespace-break-spaces",
];

const OUTSIDE_ITS_BOX =
	/^-?(left|right|inset-x)-full$|^-(left|right|inset-x|mx|ml|mr)-|^-?translate-x-/;

export function sidewaysLeaks(root: Element): string[] {
	const leaks = new Set<string>();
	for (const element of root.querySelectorAll("*")) {
		const placed = [...classesOf(element)].find((name) =>
			OUTSIDE_ITS_BOX.test(name),
		);
		if (placed)
			leaks.add(`sits outside its box (${placed}): ${named(element)}`);
	}
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!UNBROKEN.test(node.textContent ?? "")) continue;
		let fits = false;
		let anywhere = false;
		for (
			let at = node.parentElement;
			at !== null && root.contains(at);
			at = at.parentElement
		) {
			const classes = classesOf(at);
			if (ends(classes) || WRAPS_ANYWHERE.some((name) => classes.has(name)))
				anywhere = true;
			if ((at.tagName === "TD" || at.tagName === "TH") && !anywhere)
				leaks.add(`cell does not wrap anywhere: ${named(at)}`);
			if (ends(classes)) fits = true;
			else if (
				!fits &&
				(KEEPS_ONE_LINE.some((name) => classes.has(name)) ||
					(at.tagName === "PRE" &&
						!WRAPS_LINES.some((name) => classes.has(name))))
			) {
				leaks.add(`does not wrap: ${named(at)}`);
				fits = true;
			} else if (WRAPS.some((name) => classes.has(name))) fits = true;
			if (CLIPS.some((name) => classes.has(name)) && !ends(classes))
				leaks.add(`clips: ${named(at)}`);
			if (SCROLLS_SIDEWAYS.some((name) => classes.has(name)))
				leaks.add(`scrolls sideways: ${named(at)}`);
			if (
				at !== root &&
				laidInARow(classesOf(at.parentElement)) &&
				(!classes.has("min-w-0") || classes.has("flex-none"))
			)
				leaks.add(`cannot shrink: ${named(at)}`);
		}
		if (!fits)
			leaks.add(
				`does not wrap: ${node.parentElement ? named(node.parentElement) : "#text"}`,
			);
	}
	return [...leaks];
}
