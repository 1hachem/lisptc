export type RemoteProblem =
	| "BAD_URL"
	| "NOT_FOUND"
	| "NO_ACCESS"
	| "READ_ONLY"
	| "UNREACHABLE";

export interface GitCredential {
	readonly username: string;
	readonly token: string;
}

export function cloneUrl(text: string): URL | undefined {
	let url: URL;
	try {
		url = new URL(text.trim());
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
		return undefined;
	if (url.search !== "" || url.hash !== "" || url.pathname.length < 2)
		return undefined;
	return url;
}

function infoRefs(url: URL, service: string): string {
	const base = url.href.replace(/\/+$/, "");
	return `${base}/info/refs?service=${service}`;
}

function basicAuth({ username, token }: GitCredential): string {
	return `Basic ${btoa(`${username}:${token}`)}`;
}

async function advertises(
	url: URL,
	service: string,
	credential: GitCredential,
): Promise<number> {
	const response = await fetch(infoRefs(url, service), {
		headers: {
			authorization: basicAuth(credential),
			"user-agent": "git/2.45.0 (lisptc)",
		},
		redirect: "follow",
	});
	await response.body?.cancel();
	return response.status;
}

export async function probeRemote(
	text: string,
	credential: GitCredential,
): Promise<RemoteProblem | undefined> {
	const url = cloneUrl(text);
	if (url === undefined) return "BAD_URL";
	try {
		const read = await advertises(url, "git-upload-pack", credential);
		if (read === 404) return "NOT_FOUND";
		if (read === 401 || read === 403) return "NO_ACCESS";
		if (read !== 200) return "UNREACHABLE";
		const write = await advertises(url, "git-receive-pack", credential);
		if (write === 401 || write === 403 || write === 404) return "READ_ONLY";
		if (write !== 200) return "UNREACHABLE";
		return undefined;
	} catch {
		return "UNREACHABLE";
	}
}
