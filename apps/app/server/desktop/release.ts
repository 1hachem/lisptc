const LATEST_RELEASE =
	"https://api.github.com/repos/1hachem/lisptc/releases/latest";

const KEEP_FOR_MS = 10 * 60_000;

export interface DesktopRelease {
	readonly tag: string;
	readonly publishedAt: string;
}

interface ReleasePorts {
	fetch(url: string): Promise<Response>;
	now(): number;
}

export function latestRelease(ports: ReleasePorts) {
	let kept: { release: DesktopRelease | null; at: number } | undefined;
	return async (): Promise<DesktopRelease | null> => {
		if (kept !== undefined && ports.now() - kept.at < KEEP_FOR_MS)
			return kept.release;
		const release = await read(ports).catch(() => null);
		kept = { release, at: ports.now() };
		return release;
	};
}

async function read(ports: ReleasePorts): Promise<DesktopRelease | null> {
	const response = await ports.fetch(LATEST_RELEASE);
	if (!response.ok) return null;
	const body: unknown = await response.json();
	if (typeof body !== "object" || body === null) return null;
	const { tag_name: tag, published_at: publishedAt } = body as Record<
		string,
		unknown
	>;
	return typeof tag === "string" && typeof publishedAt === "string"
		? { tag, publishedAt }
		: null;
}

const desktopRelease = latestRelease({
	fetch: (url) =>
		fetch(url, { headers: { accept: "application/vnd.github+json" } }),
	now: Date.now,
});

export async function serveDesktopRelease(): Promise<Response> {
	return Response.json(await desktopRelease());
}
