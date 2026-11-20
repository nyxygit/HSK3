"""Produce the final HSK 3.0 dataset (11 000 cards) from the poster PDF.

The poster is a single 4050x6470pt sheet: 75 card columns by 147 card rows, each
cell 52x40pt. Seven HSK level rectangles tile that grid, and words are filled
left to right, top to bottom inside each rectangle. Reproducing the grid keeps
the PDF's ordering exactly, so the app can render the same map.
"""

import collections
import json
import sys

sys.path.insert(0, "tools")
from build_dataset import load, scan  # noqa: E402

PDF_PATH = r"C:\Users\yaggi\Desktop\HSK 3.0.pdf"

COLS, ROWS = 75, 147
CELL_W, CELL_H = 52.0, 40.0
GRID_X, GRID_Y = 100.55, 6030.55  # top-left of cell (0,0)

# (level, col0, col1, row0, row1) measured from the poster's card fills
RECTS = [
    (1, 0, 24, 0, 11),
    (2, 0, 24, 12, 19),
    (3, 0, 24, 20, 39),
    (4, 25, 49, 0, 39),
    (5, 0, 49, 40, 71),
    (6, 50, 74, 0, 71),
    (7, 0, 74, 72, 146),
]

COLOR_LEVEL = {
    (1.0, 0.7529, 0.0): 1,
    (0.3059, 0.5843, 0.851): 2,
    (1.0, 0.2, 0.0): 3,
    (0.7529, 0.0, 0.0): 4,
    (0.0, 0.1255, 0.3765): 5,
    (0.4392, 0.1882, 0.6275): 6,
    (0.3059, 0.6549, 0.1804): 7,
}


def level_for(row, col):
    for lv, c0, c1, r0, r1 in RECTS:
        if c0 <= col <= c1 and r0 <= row <= r1:
            return lv
    return None


def main():
    content, fonts = load(PDF_PATH)
    runs, cards = scan(content, fonts)

    # Stream order: card rect, hanzi run(s), pinyin run(s). Group by origin.
    items = []
    for x, y, font, size, text in runs:
        if not text:
            continue
        if font.startswith("F3"):
            if items and abs(items[-1]["x"] - x) < 0.01 and abs(items[-1]["y"] - y) < 0.01:
                items[-1]["hanzi"] += text
            else:
                items.append({"x": x, "y": y, "hanzi": text, "py": []})
        elif font.startswith("F2") and 3.0 < size < 8.0 and items:
            if abs((items[-1]["y"] - 11.0) - y) < 5.0:
                items[-1]["py"].append((x, text))

    print("words", len(items), "cards", len(cards))

    # Card fill colour per cell.
    cell_level = {}
    for color, x0, y0, x1, y1 in cards:
        col = round((x0 - GRID_X) / CELL_W)
        row = round((GRID_Y - y0) / CELL_H)
        lv = COLOR_LEVEL.get(tuple(color))
        if lv:
            cell_level[(row, col)] = lv

    grid = [[None] * COLS for _ in range(ROWS)]
    missing_lv = 0
    bad_cell = []
    for it in items:
        row = round((GRID_Y - it["y"] + 19.0) / CELL_H)
        col = round((it["x"] - GRID_X) / CELL_W)
        if not (0 <= row < ROWS and 0 <= col < COLS):
            bad_cell.append((it["hanzi"], row, col))
            row = min(max(row, 0), ROWS - 1)
            col = min(max(col, 0), COLS - 1)
        lv = cell_level.get((row, col)) or level_for(row, col)
        if lv is None:
            missing_lv += 1
        py = "".join(t for _, t in sorted(it["py"])) if it["py"] else ""
        if grid[row][col] is not None:
            print("cell collision", row, col, grid[row][col], it["hanzi"])
        grid[row][col] = {"h": it["hanzi"], "p": py, "l": lv}

    print("outside grid", bad_cell[:5], "missing level", missing_lv)

    flat = [c for row in grid for c in row if c]
    print("cells filled", len(flat))
    print("level counts", collections.Counter(c["l"] for c in flat))
    print("missing pinyin", [(c["h"], ) for c in flat if not c["p"]][:20],
          sum(1 for c in flat if not c["p"]))
    print("empty cells", [(r, c) for r in range(ROWS) for c in range(COLS) if grid[r][c] is None][:10])

    json.dump(grid, open("tools/grid.json", "w", encoding="utf-8"), ensure_ascii=False)


if __name__ == "__main__":
    main()
