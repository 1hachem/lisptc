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

export function postJson(
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

type Leaks = Set<string>;

interface Reach {
	fits: boolean;
	anywhere: boolean;
}

function hasAny(classes: Set<string>, names: readonly string[]): boolean {
	return names.some((name) => classes.has(name));
}

function placedOutside(root: Element, leaks: Leaks): void {
	for (const element of root.querySelectorAll("*")) {
		const placed = [...classesOf(element)].find((name) =>
			OUTSIDE_ITS_BOX.test(name),
		);
		if (placed)
			leaks.add(`sits outside its box (${placed}): ${named(element)}`);
	}
}

function longTexts(root: Element): Node[] {
	const found: Node[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode())
		if (UNBROKEN.test(node.textContent ?? "")) found.push(node);
	return found;
}

function keepsOneLine(at: Element, classes: Set<string>): boolean {
	return (
		hasAny(classes, KEEPS_ONE_LINE) ||
		(at.tagName === "PRE" && !hasAny(classes, WRAPS_LINES))
	);
}

function wrapping(
	at: Element,
	classes: Set<string>,
	reach: Reach,
	leaks: Leaks,
): void {
	if (ends(classes) || hasAny(classes, WRAPS_ANYWHERE)) reach.anywhere = true;
	if ((at.tagName === "TD" || at.tagName === "TH") && !reach.anywhere)
		leaks.add(`cell does not wrap anywhere: ${named(at)}`);
	if (ends(classes)) reach.fits = true;
	else if (!reach.fits && keepsOneLine(at, classes)) {
		leaks.add(`does not wrap: ${named(at)}`);
		reach.fits = true;
	} else if (hasAny(classes, WRAPS)) reach.fits = true;
}

function holdsATable(at: Element): boolean {
	return (
		classesOf(at).has("min-w-0") &&
		at.children.length === 1 &&
		at.firstElementChild?.tagName === "TABLE"
	);
}

function bounds(
	at: Element,
	classes: Set<string>,
	root: Element,
	leaks: Leaks,
): void {
	if (hasAny(classes, CLIPS) && !ends(classes))
		leaks.add(`clips: ${named(at)}`);
	if (hasAny(classes, SCROLLS_SIDEWAYS) && !holdsATable(at))
		leaks.add(`scrolls sideways: ${named(at)}`);
	const shrinks = classes.has("min-w-0") && !classes.has("flex-none");
	if (at !== root && laidInARow(classesOf(at.parentElement)) && !shrinks)
		leaks.add(`cannot shrink: ${named(at)}`);
}

function followText(node: Node, root: Element, leaks: Leaks): void {
	const reach: Reach = { fits: false, anywhere: false };
	for (
		let at = node.parentElement;
		at !== null && root.contains(at);
		at = at.parentElement
	) {
		const classes = classesOf(at);
		wrapping(at, classes, reach, leaks);
		bounds(at, classes, root, leaks);
	}
	if (!reach.fits)
		leaks.add(
			`does not wrap: ${node.parentElement ? named(node.parentElement) : "#text"}`,
		);
}

export function sidewaysLeaks(root: Element): string[] {
	const leaks: Leaks = new Set();
	placedOutside(root, leaks);
	for (const node of longTexts(root)) followText(node, root, leaks);
	return [...leaks];
}
