import { googleSheetsEnv } from "@repo/env/mcps/google/sheets";
import { FastMCP, UserError } from "fastmcp";
import { z } from "zod";
import {
	credentialsFrom,
	GoogleAuthError,
	googleProvider,
} from "../google-auth.ts";
import {
	addWorksheet,
	appendSheetRows,
	clearSheetData,
	createSpreadsheet,
	getSheetData,
	getSpreadsheet,
	listSpreadsheets,
	updateSheetData,
} from "./api.ts";

const PORT = googleSheetsEnv.LISPTC_SHEETS_PORT;
const BASE_URL =
	googleSheetsEnv.LISPTC_SHEETS_URL ?? `http://localhost:${PORT}`;

const server = new FastMCP({
	name: "sheets",
	version: "0.0.0",
	auth: googleProvider({ server: "sheets", baseUrl: BASE_URL }),
});

async function json<T>(work: () => Promise<T>): Promise<string> {
	try {
		return JSON.stringify(await work());
	} catch (err) {
		if (err instanceof GoogleAuthError) throw new UserError(err.message);
		throw new UserError(err instanceof Error ? err.message : String(err));
	}
}

const spreadsheetId = z
	.string()
	.describe("The spreadsheet id, the long token in its URL after /d/.");

const a1 = z
	.string()
	.describe(
		'A1 notation range, e.g. "Ledger!A1:F5000". Omit the sheet name to mean the first sheet.',
	);

const grid = z
	.array(z.array(z.string()))
	.describe("A 2D array of cell values; each inner array is one row.");

server.addTool({
	name: "list-spreadsheets",
	description:
		"List the spreadsheets in the connected Google Drive, newest first. Returns JSON: {spreadsheets:[{id,name,modifiedTime}]}.",
	parameters: z.object({
		"folder-id": z
			.string()
			.optional()
			.describe("Only list spreadsheets in this Drive folder id."),
	}),
	execute: (args, { session }) =>
		json(() => listSpreadsheets(credentialsFrom(session), args["folder-id"])),
});

server.addTool({
	name: "get-spreadsheet",
	description:
		"Describe one spreadsheet without reading its cells: title, url, and every worksheet with its row and column count. Use this before reading a range so you know how far the data goes. Returns JSON.",
	parameters: z.object({ "spreadsheet-id": spreadsheetId }),
	execute: (args, { session }) =>
		json(() =>
			getSpreadsheet(credentialsFrom(session), args["spreadsheet-id"]),
		),
});

server.addTool({
	name: "get-sheet-data",
	description:
		"Read a range of cells. With :as-objects nil (the default) returns JSON {range,rowCount,values:[[…]]}; with :as-objects t the first row of the range is treated as a header and it returns {range,rowCount,keys,rows:[{header:value}]}, which is the shape to map over. Read in bounded ranges rather than whole sheets.",
	parameters: z.object({
		"spreadsheet-id": spreadsheetId,
		range: a1,
		"as-objects": z
			.boolean()
			.optional()
			.default(false)
			.describe("Treat the first row of the range as a header row."),
	}),
	execute: (args, { session }) =>
		json(() =>
			getSheetData(
				credentialsFrom(session),
				args["spreadsheet-id"],
				args.range,
				args["as-objects"],
			),
		),
});

server.addTool({
	name: "update-sheet-data",
	description:
		"Overwrite a range with the given rows. Values are entered as if typed, so formulas and dates are parsed. Returns JSON {updatedRange,updatedCells,updatedRows}.",
	parameters: z.object({
		"spreadsheet-id": spreadsheetId,
		range: a1,
		values: grid,
	}),
	execute: (args, { session }) =>
		json(() =>
			updateSheetData(
				credentialsFrom(session),
				args["spreadsheet-id"],
				args.range,
				args.values,
			),
		),
});

server.addTool({
	name: "append-rows",
	description:
		'Append rows after the last row that has content. Pass any range that names the target sheet, e.g. "Ledger!A1". Returns JSON {updatedRange,appendedRows}.',
	parameters: z.object({
		"spreadsheet-id": spreadsheetId,
		range: a1,
		values: grid,
	}),
	execute: (args, { session }) =>
		json(() =>
			appendSheetRows(
				credentialsFrom(session),
				args["spreadsheet-id"],
				args.range,
				args.values,
			),
		),
});

server.addTool({
	name: "clear-range",
	description:
		"Delete the values in a range, keeping the cells and their formatting. Returns JSON {clearedRange}.",
	parameters: z.object({ "spreadsheet-id": spreadsheetId, range: a1 }),
	execute: (args, { session }) =>
		json(() =>
			clearSheetData(
				credentialsFrom(session),
				args["spreadsheet-id"],
				args.range,
			),
		),
});

server.addTool({
	name: "add-worksheet",
	description:
		"Add a worksheet (a tab) to an existing spreadsheet. Returns JSON {title,sheetId}.",
	parameters: z.object({
		"spreadsheet-id": spreadsheetId,
		title: z.string().describe("Name for the new worksheet."),
	}),
	execute: (args, { session }) =>
		json(() =>
			addWorksheet(
				credentialsFrom(session),
				args["spreadsheet-id"],
				args.title,
			),
		),
});

server.addTool({
	name: "create-spreadsheet",
	description:
		"Create a new spreadsheet in the connected Drive. Returns JSON {title,spreadsheetId,spreadsheetUrl}.",
	parameters: z.object({
		title: z.string().describe("Title for the new spreadsheet."),
		"folder-id": z
			.string()
			.optional()
			.describe("Drive folder id to create it in."),
	}),
	execute: (args, { session }) =>
		json(() =>
			createSpreadsheet(
				credentialsFrom(session),
				args.title,
				args["folder-id"],
			),
		),
});

await server.start({
	transportType: "httpStream",
	httpStream: { endpoint: "/mcp", port: PORT },
});
