describe("lisptc.lsp", function()
	local config = require("lisptc.lsp")

	it("only attaches to lisptc buffers, rooted at the nearest .git", function()
		assert.are.same({ "lisptc" }, config.filetypes)
		assert.are.same({ ".git" }, config.root_markers)
	end)

	it("launches the LSP server pinned to the shared session key", function()
		assert.are.same({
			"env",
			"LISPTC_SESSION=lisptc",
			"LISPTC_OWNER_PID=" .. vim.fn.getpid(),
			"node",
			"--no-warnings",
			"--experimental-transform-types",
			vim.fn.expand("~/lisptc/apps/lsp/src/server.ts"),
			"--stdio",
		}, config.cmd)
	end)
end)
