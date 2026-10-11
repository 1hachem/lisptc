import { createMiddleware } from "@tanstack/react-start";

export const logged = createMiddleware({ type: "request" }).server(
	async ({ request, pathname, next }) => {
		const started = performance.now();
		console.log(`<-- ${request.method} ${pathname}`);
		const result = await next();
		const elapsed = Math.round(performance.now() - started);
		console.log(
			`--> ${request.method} ${pathname} ${result.response.status} ${elapsed}ms`,
		);
		return result;
	},
);
