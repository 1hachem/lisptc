import { Interp, runAsync } from "@repo/interpreter/lisp";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import type { AttachedFile } from "@repo/shared/files";
import { attached, knowledgeExtension } from "../src/knowledge.ts";
import { knowledgeHostFor } from "../src/knowledge-host.ts";
import { MemoryKnowledgeStore } from "../src/memory-store.ts";
import type { Downloader, PdfReader } from "../src/ports.ts";

export interface World {
	ev(code: string): Promise<string>;
	store: MemoryKnowledgeStore;
	attached: AttachedFile[];
}

const offline: Downloader = {
	download: async (url) => {
		throw new Error(`offline: ${url.href}`);
	},
};

export async function world(
	downloader = offline,
	pdf?: PdfReader,
): Promise<World> {
	const store = new MemoryKnowledgeStore();
	const interp = new Interp({
		extensions: [
			knowledgeExtension(
				knowledgeHostFor({ store, downloader, pdf, maxDownloadBytes: 1024 }),
			),
		],
	});
	await runAsync(interp, prelude);
	const shown: AttachedFile[] = [];
	attached.on(interp.channels, (file) => shown.push(file));
	return {
		store,
		attached: shown,
		ev: async (code) => str((await runAsync(interp, code)).value),
	};
}

export function pdfSaying(...pages: string[]): Uint8Array {
	const pageIds = pages.map((_, i) => 4 + i * 2);
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		...pages.flatMap((line, i) => {
			const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
			return [
				`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
				`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
			];
		}),
	];
	let body = "%PDF-1.4\n";
	const offsets = objects.map((object, i) => {
		const offset = body.length;
		body += `${i + 1} 0 obj\n${object}\nendobj\n`;
		return offset;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets)
		body += `${String(offset).padStart(10, "0")} 00000 n \n`;
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(body);
}
