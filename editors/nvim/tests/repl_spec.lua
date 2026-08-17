-- repl.lua depends on iron.nvim (`iron.fts.common`), which isn't installed in
-- the test environment, so it's stubbed before requiring the module.
describe("lisptc.repl", function()
	local fake_bracketed_paste = function() end

	before_each(function()
		package.loaded["lisptc.repl"] = nil
		package.loaded["iron.fts.common"] = { bracketed_paste = fake_bracketed_paste }
	end)

	after_each(function()
		package.loaded["iron.fts.common"] = nil
	end)

	it("attaches the REPL to the shared session key", function()
		local repl = require("lisptc.repl")
		assert.are.same({
			"env",
			"LISPTC_SESSION=lisptc",
			"pnpm",
			"--silent",
			"-C",
			vim.fn.expand("~/lisptc"),
			"run",
			"repl:attach",
		}, repl.command)
	end)

	it("formats input with Iron's bracketed-paste helper", function()
		local repl = require("lisptc.repl")
		assert.are.equal(fake_bracketed_paste, repl.format)
	end)
end)
