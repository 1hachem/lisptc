import type { JevHost } from "@repo/jev/jev";
import { jevHost } from "@repo/jev/jev-host";
import { jevExcuse, jevSort } from "./jev.ts";
import type { ProseHost } from "./prose.ts";
import { proseHost } from "./prose-host.ts";

export function jevProseHost(host: JevHost = jevHost): ProseHost {
	return { ...proseHost, sort: jevSort(host), excuse: jevExcuse(host) };
}
