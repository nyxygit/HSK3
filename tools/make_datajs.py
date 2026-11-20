"""Emit data.js (window.HSK) from the extracted poster grid.

Compact payload: 147 rows of 75 cells, each cell "hanzi|pinyin" or null.
Level membership is derivable from the poster's level rectangles.
"""

import json

grid = json.load(open("tools/grid.json", encoding="utf-8"))

rows = []
for row in grid:
    out = []
    for cell in row:
        out.append(None if cell is None else "%s|%s" % (cell["h"], cell["p"]))
    rows.append(out)

levels = [
    {"n": 1, "label": "1", "name": "Nivel 1", "zh": "一级", "py": "yī jí", "count": 300,
     "color": "#FFC000", "c0": 0, "c1": 24, "r0": 0, "r1": 11},
    {"n": 2, "label": "2", "name": "Nivel 2", "zh": "二级", "py": "èr jí", "count": 200,
     "color": "#4E95D9", "c0": 0, "c1": 24, "r0": 12, "r1": 19},
    {"n": 3, "label": "3", "name": "Nivel 3", "zh": "三级", "py": "sān jí", "count": 500,
     "color": "#FF3300", "c0": 0, "c1": 24, "r0": 20, "r1": 39},
    {"n": 4, "label": "4", "name": "Nivel 4", "zh": "四级", "py": "sì jí", "count": 1000,
     "color": "#C00000", "c0": 25, "c1": 49, "r0": 0, "r1": 39},
    {"n": 5, "label": "5", "name": "Nivel 5", "zh": "五级", "py": "wǔ jí", "count": 1600,
     "color": "#002060", "c0": 0, "c1": 49, "r0": 40, "r1": 71},
    {"n": 6, "label": "6", "name": "Nivel 6", "zh": "六级", "py": "liù jí", "count": 1800,
     "color": "#7030A0", "c0": 50, "c1": 74, "r0": 0, "r1": 71},
    {"n": 7, "label": "7–9", "name": "Niveles 7–9", "zh": "七–九级", "py": "qī–jiǔ jí", "count": 5600,
     "color": "#4EA72E", "c0": 0, "c1": 74, "r0": 72, "r1": 146},
]

payload = {
    "cols": 75,
    "rows": 147,
    "cellW": 64,
    "cellH": 50,
    "total": sum(1 for r in rows for c in r if c),
    "levels": levels,
    "grid": rows,
}

with open("data.js", "w", encoding="utf-8") as fh:
    fh.write("window.HSK = ")
    json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    fh.write(";\n")

print("wrote data.js", len(open("data.js", encoding="utf-8").read()), "chars, total", payload["total"])
