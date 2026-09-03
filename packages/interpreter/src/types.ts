// A value that knows its own JSON wire form. Duck-typed by consumers (e.g.
// lispToJson in src/mcp.ts): this is the one path that reveals a tainted
// value's underlying data — its display form stays redacted (src/secrets.ts).
export interface ToJson {
	toJSON(): unknown;
}
