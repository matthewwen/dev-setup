#!/usr/bin/env python3
"""Rearrange the panes of the active tab, like tmux select-layout.

Usage: select-layout.sh [LAYOUT]
  LAYOUT is one of: tiled, even-horizontal, even-vertical,
  main-vertical, main-horizontal. With no argument, cycle to the next one.

herdr's layout.apply replaces panes with new shells, so this script instead
moves each existing pane out to a parking tab and back into the target tab
at the wanted position. Processes keep running. Split ratios are then
equalized with layout.set_split_ratio.
"""
import json
import math
import os
import socket
import sys
import time

LAYOUTS = ["tiled", "even-horizontal", "even-vertical", "main-vertical", "main-horizontal"]
STATE_DIR = os.path.join(os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "herdr")


def rpc(method, params):
    sock_path = os.environ.get("HERDR_SOCKET_PATH")
    if not sock_path:
        sys.exit("HERDR_SOCKET_PATH is not set; run inside herdr.")
    req = {"id": f"select-layout:{method}:{time.time_ns()}", "method": method, "params": params}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as c:
        c.settimeout(5)
        c.connect(sock_path)
        c.sendall((json.dumps(req) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = c.recv(65536)
            if not chunk:
                break
            buf += chunk
    resp = json.loads(buf)
    if "error" in resp:
        sys.exit(f"{method}: {resp['error'].get('message')}")
    return resp["result"]


def leaves(node):
    if node["type"] == "pane":
        return [node["pane_id"]]
    return leaves(node["first"]) + leaves(node["second"])


def chain(node, direction):
    """Panes reachable through splits in the same direction. Other subtrees count as one."""
    if node["type"] == "pane" or node["direction"] != direction:
        return 1
    return chain(node["first"], direction) + chain(node["second"], direction)


def equalize(tab_id, node, path):
    if node["type"] == "pane":
        return
    a = chain(node["first"], node["direction"])
    b = chain(node["second"], node["direction"])
    rpc("layout.set_split_ratio", {"tab_id": tab_id, "path": path, "ratio": a / (a + b)})
    equalize(tab_id, node["first"], path + [False])
    equalize(tab_id, node["second"], path + [True])


def move(pane_id, destination):
    res = rpc("pane.move", {"pane_id": pane_id, "destination": destination, "focus": False})
    return res["move_result"]["pane"]["pane_id"]


def placements(layout, panes):
    """Yield (pane, anchor_index, direction) for panes[1:]."""
    n = len(panes)
    if layout == "even-horizontal":
        return [(i, i - 1, "right") for i in range(1, n)]
    if layout == "even-vertical":
        return [(i, i - 1, "down") for i in range(1, n)]
    if layout == "main-vertical":
        return [(1, 0, "right")] + [(i, i - 1, "down") for i in range(2, n)]
    if layout == "main-horizontal":
        return [(1, 0, "down")] + [(i, i - 1, "right") for i in range(2, n)]
    cols = math.ceil(math.sqrt(n))
    out = [(i, i - 1, "right") for i in range(1, min(cols, n))]
    for i in range(cols, n):
        out.append((i, i - cols, "down"))
    return out


def main():
    pane = os.environ.get("HERDR_ACTIVE_PANE_ID") or os.environ.get("HERDR_PANE_ID")
    if not pane:
        sys.exit("No active pane id in environment.")
    export = rpc("layout.export", {"pane_id": pane})["layout"]
    tab_id = export["tab_id"]
    focused = export.get("focused_pane_id")
    panes = leaves(export["root"])
    if len(panes) < 2:
        return

    os.makedirs(STATE_DIR, exist_ok=True)
    state = os.path.join(STATE_DIR, f"layout-{tab_id.replace(':', '_')}")
    if len(sys.argv) > 1:
        layout = sys.argv[1]
        if layout not in LAYOUTS:
            sys.exit(f"unknown layout {layout}; choose from {', '.join(LAYOUTS)}")
    else:
        try:
            with open(state) as f:
                current = f.read().strip()
        except OSError:
            current = ""
        layout = LAYOUTS[(LAYOUTS.index(current) + 1) % len(LAYOUTS)] if current in LAYOUTS else LAYOUTS[0]

    ids = list(panes)
    for idx, anchor, direction in placements(layout, panes):
        parked = move(ids[idx], {"type": "new_tab", "label": "select-layout"})
        ids[idx] = move(parked, {"type": "tab", "tab_id": tab_id, "split": direction,
                                 "target_pane_id": ids[anchor]})

    export = rpc("layout.export", {"tab_id": tab_id})["layout"]
    equalize(tab_id, export["root"], [])
    if focused:
        rpc("pane.focus", {"pane_id": focused})
    with open(state, "w") as f:
        f.write(layout)
    print(layout)


if __name__ == "__main__":
    main()
