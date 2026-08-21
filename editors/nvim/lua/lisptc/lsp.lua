local SESSION = require("lisptc.session")

-- LISPTC_OWNER_PID ties a freshly-spawned session server to this nvim process,
-- so it exits (and deletes its socket) once nvim closes instead of lingering.
return {
	cmd = {
		"env",
		"LISPTC_SESSION=" .. SESSION,
		"LISPTC_OWNER_PID=" .. vim.fn.getpid(),
		"node",
		"--no-warnings",
		"--experimental-transform-types",
		vim.fn.expand("~/lisptc/apps/lsp/src/server.ts"),
		"--stdio",
	},
	filetypes = { "lisptc" },
	root_markers = { ".git" },
}
