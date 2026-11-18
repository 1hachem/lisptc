local SESSION = require("lisptc.session")

return {
	cmd = {
		"env",
		"LISPTC_SESSION=" .. SESSION,
		"node",
		"--no-warnings",
		"--experimental-transform-types",
		"--env-file-if-exists=" .. vim.fn.expand("~/lisptc/.env"),
		vim.fn.expand("~/lisptc/apps/lsp/src/server.ts"),
		"--stdio",
	},
	filetypes = { "lisptc" },
	root_markers = { ".git" },
}
