import { LandingView } from "@repo/landing-components";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { builtInPage, startHref } from "../lib/site-pages.ts";

export const Route = createFileRoute("/site/$vertical")({
	loader: ({ params }) => {
		const page = builtInPage(params.vertical);
		if (page === undefined) throw notFound();
		return { page };
	},
	head: ({ loaderData }) => ({
		meta:
			loaderData === undefined
				? []
				: [
						{ title: loaderData.page.title },
						...(loaderData.page.description === undefined
							? []
							: [
									{ name: "description", content: loaderData.page.description },
								]),
					],
	}),
	component: Site,
});

function Site() {
	const { page } = Route.useLoaderData();
	return <LandingView page={page} start={startHref} />;
}
