import { LandingView } from "@repo/landing-components";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { builtInPage, MAIN_VERTICAL, startHref } from "../lib/site-pages.ts";

export const Route = createFileRoute("/")({
	loader: () => {
		const page = builtInPage(MAIN_VERTICAL);
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
	component: MainLanding,
});

function MainLanding() {
	const { page } = Route.useLoaderData();
	return <LandingView page={page} start={startHref} />;
}
