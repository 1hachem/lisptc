export type SignedOutPage = "landing" | "login";

export function signedOutPage(
	pathname: string,
	desktop: boolean,
): SignedOutPage {
	return pathname === "/" && !desktop ? "landing" : "login";
}
