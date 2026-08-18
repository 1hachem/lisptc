local stub = require("luassert.stub")

-- init.lua depends on cmp_nvim_lsp, which isn't installed in the test
-- environment, so it's stubbed before requiring the module.
describe("lisptc.init", function()
	before_each(function()
		package.loaded["lisptc.init"] = nil
		package.loaded["cmp_nvim_lsp"] = {
			default_capabilities = function()
				return { fake_capabilities = true }
			end,
		}
	end)

	after_each(function()
		package.loaded["cmp_nvim_lsp"] = nil
	end)

	it("registers the lisptc LSP config with cmp's capabilities merged in, then enables it", function()
		local config_stub = stub(vim.lsp, "config")
		local enable_stub = stub(vim.lsp, "enable")

		require("lisptc.init").setup()

		assert.stub(config_stub).was_called(1)
		local name, config = unpack(config_stub.calls[1].vals)
		assert.are.equal("lisptc", name)
		assert.are.equal("lisptc", config.filetypes[1])
		assert.are.same({ fake_capabilities = true }, config.capabilities)

		assert.stub(enable_stub).was_called_with("lisptc")

		config_stub:revert()
		enable_stub:revert()
	end)
end)
