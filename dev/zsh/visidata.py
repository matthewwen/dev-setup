def _dev_setup_visidata_clipboard():
    import os
    import shutil
    from visidata import Sheet, vd

    if shutil.which('pbcopy'):
        vd.options.clipboard_copy_cmd = 'pbcopy'
    elif os.environ.get('WAYLAND_DISPLAY') and shutil.which('wl-copy'):
        vd.options.clipboard_copy_cmd = 'wl-copy'
    elif shutil.which('xclip'):
        vd.options.clipboard_copy_cmd = 'xclip -selection clipboard'
    elif shutil.which('xsel'):
        vd.options.clipboard_copy_cmd = 'xsel --clipboard --input'

    copy_rows = Sheet.copyRows
    copy_cells = Sheet.copyCells

    def copyRows(sheet, rows):
        copy_rows(sheet, rows)
        if rows:
            sheet.syscopyCells(sheet.visibleCols, rows)

    def copyCells(sheet, col, rows):
        copy_cells(sheet, col, rows)
        if len(rows) == 1:
            sheet.syscopyValue(col.getDisplayValue(rows[0]))
        elif rows:
            sheet.syscopyCells([col], rows)

    def syscopyCells(sheet, cols, rows, filetype=None):
        if rows:
            sheet.syscopyValue('\n'.join(
                '\t'.join(col.getDisplayValue(row) for col in cols)
                for row in rows
            ))

    Sheet.api(syscopyCells)
    Sheet.api(copyRows)
    Sheet.api(copyCells)


_dev_setup_visidata_clipboard()
