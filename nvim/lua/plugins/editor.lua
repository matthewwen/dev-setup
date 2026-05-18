return {
  -- Telescope: rg-powered search, C-t opens result in new tab
  {
    "nvim-telescope/telescope.nvim",
    opts = {
      defaults = {
        vimgrep_arguments = {
          "rg",
          "--color=never",
          "--no-heading",
          "--with-filename",
          "--line-number",
          "--column",
          "--smart-case",
          "--hidden",
          "--glob=!.git/",
        },
        mappings = {
          i = {
            ["<C-t>"] = "select_tab",
          },
          n = {
            ["<C-t>"] = "select_tab",
          },
        },
      },
    },
    keys = {
      { "<C-p>", "<cmd>Telescope find_files<cr>", desc = "Find Files" },
      { "<C-f>", "<cmd>Telescope current_buffer_fuzzy_find<cr>", desc = "Buffer Lines" },
      { "<leader>f", "<cmd>Telescope live_grep<cr>", desc = "Grep (rg)" },
      { "<leader>b", "<cmd>Telescope buffers<cr>", desc = "Buffers" },
    },
  },

  { "nvim-neo-tree/neo-tree.nvim", enabled = false },

  -- Snacks explorer: open file in new tab with 't'
  {
    "folke/snacks.nvim",
    opts = {
      picker = {
        sources = {
          explorer = {
            actions = {
              open_tab = function(picker, item)
                if item and item.file and not item.dir then
                  picker:close()
                  vim.cmd("tabedit " .. vim.fn.fnameescape(item.file))
                end
              end,
            },
            win = {
              list = {
                keys = {
                  ["t"] = "open_tab",
                },
              },
            },
          },
        },
      },
    },
  },

  -- Git signs in the gutter
  {
    "lewis6991/gitsigns.nvim",
    opts = {
      current_line_blame = true,
    },
  },
}
