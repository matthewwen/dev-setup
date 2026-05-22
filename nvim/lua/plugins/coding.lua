return {
  -- Force shfmt to use 4-space indent
  {
    "stevearc/conform.nvim",
    opts = {
      formatters = {
        shfmt = {
          prepend_args = { "-i", "4" },
        },
      },
    },
  },

  -- Treesitter: ensure common languages are installed
  {
    "nvim-treesitter/nvim-treesitter",
    opts = {
      ensure_installed = {
        "bash",
        "json",
        "lua",
        "markdown",
        "python",
        "rust",
        "typescript",
        "yaml",
      },
    },
  },

  -- LSP: add servers you use (install via :MasonInstall <name>)
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        rust_analyzer = {},
        lua_ls = {},
      },
    },
  },

}
