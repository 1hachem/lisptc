local function plugin_dir()
	local tests_dir = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h")
	return vim.fn.fnamemodify(tests_dir, ":h")
end

describe("ftdetect/lisptc", function()
	before_each(function()
		dofile(plugin_dir() .. "/ftdetect/lisptc.lua")
	end)

	it("maps the .ptc extension to the lisptc filetype", function()
		assert.are.equal("lisptc", vim.filetype.match({ filename = "foo.ptc" }))
	end)

	it("aliases lisptc to the commonlisp treesitter parser", function()
		assert.are.equal("commonlisp", vim.treesitter.language.get_lang("lisptc"))
	end)

	it("sets legacy 'lisp' syntax highlighting on lisptc buffers", function()
		vim.cmd("edit! " .. vim.fn.tempname() .. ".ptc")
		assert.are.equal("lisptc", vim.bo.filetype)
		assert.are.equal("lisp", vim.bo.syntax)
	end)
end)
