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

	it("does not alias lisptc to a treesitter parser", function()
		-- The commonlisp parser reads a whole buffer as code; here only the
		-- parenthesised forms are code, so syntax/lisptc.vim highlights instead.
		assert.are_not.equal("commonlisp", vim.treesitter.language.get_lang("lisptc"))
	end)

	it("sets the lisptc syntax on lisptc buffers", function()
		vim.cmd("edit! " .. vim.fn.tempname() .. ".ptc")
		assert.are.equal("lisptc", vim.bo.filetype)
		assert.are.equal("lisptc", vim.bo.syntax)
	end)

	it("highlights prose around the forms as a comment", function()
		vim.opt.runtimepath:append(plugin_dir())
		local file = vim.fn.tempname() .. ".ptc"
		vim.fn.writefile({ "a smiley :) then (+ 1 2)" }, file)
		vim.cmd("syntax enable")
		vim.cmd("edit! " .. file)
		local function group(col)
			return vim.fn.synIDattr(
				vim.fn.synIDtrans(vim.fn.synID(1, col, 1)),
				"name"
			)
		end
		assert.are.equal("Comment", group(1)) -- "a"
		assert.are.equal("Comment", group(11)) -- the ")" of ":)"
		assert.are.equal("Delimiter", group(18)) -- the "(" of the form
	end)
end)
