import type { ProseHost } from "@repo/interpreter/prose";
import { proseHost } from "@repo/interpreter/prose-host";
import type { JevHost } from "./jev.ts";
import { jevHost } from "./jev-host.ts";
import { jevExcuse, jevSort } from "./prose.ts";

export function jevProseHost(host: JevHost = jevHost): ProseHost {
	return { ...proseHost, sort: jevSort(host), excuse: jevExcuse(host) };
}
