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
