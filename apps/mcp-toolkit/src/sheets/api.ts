import type { GoogleCredentials } from "../google-auth.ts";
import { googleJson } from "../google-auth.ts";

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

type Row = Record<string, string>;

function valuesUrl(spreadsheetId: string, range: string): URL {
	return new URL(
		`${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
	);
}

export async function listSpreadsheets(
	creds: GoogleCredentials,
	folderId?: string,
) {
	const query = folderId
		? `mimeType='application/vnd.google-apps.spreadsheet' and '${folderId}' in parents and trashed=false`
		: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
	const url = new URL(DRIVE);
	url.searchParams.set("q", query);
	url.searchParams.set("fields", "files(id,name,modifiedTime)");
	url.searchParams.set("orderBy", "modifiedTime desc");
	url.searchParams.set("pageSize", "200");
	const body = await googleJson<{
		files?: { id: string; name: string; modifiedTime: string }[];
	}>(creds, url);
	return { spreadsheets: body.files ?? [] };
}

export async function getSpreadsheet(
	creds: GoogleCredentials,
	spreadsheetId: string,
) {
	const url = new URL(`${SHEETS}/${spreadsheetId}`);
	url.searchParams.set(
		"fields",
		"spreadsheetId,spreadsheetUrl,properties(title),sheets(properties(sheetId,title,index,gridProperties))",
	);
	const body = await googleJson<{
		spreadsheetId: string;
		spreadsheetUrl: string;
		properties?: { title?: string };
		sheets?: {
			properties?: {
				sheetId?: number;
				title?: string;
				gridProperties?: { rowCount?: number; columnCount?: number };
			};
		}[];
	}>(creds, url);
	return {
		spreadsheetId: body.spreadsheetId,
		spreadsheetUrl: body.spreadsheetUrl,
		title: body.properties?.title ?? "",
		sheets: (body.sheets ?? []).map((sheet) => ({
			sheetId: sheet.properties?.sheetId ?? 0,
			title: sheet.properties?.title ?? "",
			rowCount: sheet.properties?.gridProperties?.rowCount ?? 0,
			columnCount: sheet.properties?.gridProperties?.columnCount ?? 0,
		})),
	};
}

export async function getSheetData(
	creds: GoogleCredentials,
	spreadsheetId: string,
	range: string,
	asObjects: boolean,
) {
	const body = await googleJson<{ range?: string; values?: string[][] }>(
		creds,
		valuesUrl(spreadsheetId, range),
	);
	const values = body.values ?? [];
	const resolved = body.range ?? range;
	if (!asObjects) {
		return { range: resolved, rowCount: values.length, values };
	}
	const [header, ...rest] = values;
	if (!header) return { range: resolved, rowCount: 0, keys: [], rows: [] };
	const rows: Row[] = rest.map((row) =>
		Object.fromEntries(header.map((key, i) => [key, row[i] ?? ""])),
	);
	return { range: resolved, rowCount: rows.length, keys: header, rows };
}

export async function updateSheetData(
	creds: GoogleCredentials,
	spreadsheetId: string,
	range: string,
	values: string[][],
) {
	const url = valuesUrl(spreadsheetId, range);
	url.searchParams.set("valueInputOption", "USER_ENTERED");
	const body = await googleJson<{
		updatedRange?: string;
		updatedCells?: number;
		updatedRows?: number;
	}>(creds, url, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ range, majorDimension: "ROWS", values }),
	});
	return {
		updatedRange: body.updatedRange ?? range,
		updatedCells: body.updatedCells ?? 0,
		updatedRows: body.updatedRows ?? 0,
	};
}

export async function appendSheetRows(
	creds: GoogleCredentials,
	spreadsheetId: string,
	range: string,
	values: string[][],
) {
	const url = new URL(`${valuesUrl(spreadsheetId, range).toString()}:append`);
	url.searchParams.set("valueInputOption", "USER_ENTERED");
	url.searchParams.set("insertDataOption", "INSERT_ROWS");
	const body = await googleJson<{
		updates?: { updatedRange?: string; updatedRows?: number };
	}>(creds, url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ range, majorDimension: "ROWS", values }),
	});
	return {
		updatedRange: body.updates?.updatedRange ?? range,
		appendedRows: body.updates?.updatedRows ?? values.length,
	};
}

export async function clearSheetData(
	creds: GoogleCredentials,
	spreadsheetId: string,
	range: string,
) {
	const url = new URL(`${valuesUrl(spreadsheetId, range).toString()}:clear`);
	const body = await googleJson<{ clearedRange?: string }>(creds, url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{}",
	});
	return { clearedRange: body.clearedRange ?? range };
}

export async function addWorksheet(
	creds: GoogleCredentials,
	spreadsheetId: string,
	title: string,
) {
	const url = new URL(`${SHEETS}/${spreadsheetId}:batchUpdate`);
	const body = await googleJson<{
		replies?: { addSheet?: { properties?: { sheetId?: number } } }[];
	}>(creds, url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			requests: [{ addSheet: { properties: { title } } }],
		}),
	});
	return {
		title,
		sheetId: body.replies?.[0]?.addSheet?.properties?.sheetId ?? 0,
	};
}

export async function createSpreadsheet(
	creds: GoogleCredentials,
	title: string,
	folderId?: string,
) {
	const created = await googleJson<{
		spreadsheetId: string;
		spreadsheetUrl: string;
	}>(creds, SHEETS, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ properties: { title } }),
	});

	if (folderId) {
		const meta = new URL(`${DRIVE}/${created.spreadsheetId}`);
		meta.searchParams.set("fields", "parents");
		const { parents } = await googleJson<{ parents?: string[] }>(creds, meta);
		const move = new URL(`${DRIVE}/${created.spreadsheetId}`);
		move.searchParams.set("addParents", folderId);
		move.searchParams.set("removeParents", (parents ?? []).join(","));
		move.searchParams.set("fields", "id,parents");
		await googleJson(creds, move, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
	}

	return {
		title,
		spreadsheetId: created.spreadsheetId,
		spreadsheetUrl: created.spreadsheetUrl,
	};
}
