"""Build the HSK 3.0 word dataset from the PDF.

Order and level assignment come from the poster itself:
  * text runs sharing one origin belong to the same card (ReportLab splits some
    strings into per-glyph runs);
  * each card's rounded-rectangle fill colour gives its HSK level;
  * reading order is row-major, which is also the content-stream order.
"""

import collections
import json
import re
import sys

sys.path.insert(0, "tools")
from extract_pdf import PDF, resolve, tokens, unescape_literal, parse_tounicode  # noqa: E402

PDF_PATH = r"C:\Users\yaggi\Desktop\HSK 3.0.pdf"

LEVELS = [
    (1, "Nivel 1", "一级", "yī jí"),
    (2, "Nivel 2", "二级", "èr jí"),
    (3, "Nivel 3", "三级", "sān jí"),
    (4, "Nivel 4", "四级", "sì jí"),
    (5, "Nivel 5", "五级", "wǔ jí"),
    (6, "Nivel 6", "六级", "liù jí"),
    (7, "Niveles 7–9", "七–九级", "qī–jiǔ jí"),
]


def load(path):
    pdf = PDF(path)
    page = next(
        n for n in sorted(pdf.offsets)
        if b"/Type /Page" in pdf.dict_of(n) and b"/Contents" in pdf.dict_of(n)
    )
    page_dic = pdf.dict_of(page)
    content = pdf.stream_of(resolve(page_dic, b"Contents"))

    res = page_dic[page_dic.find(b"/Resources"):]
    font_dict = pdf.dict_of(resolve(res, b"Font"))
    fonts = {}
    for name, num in re.findall(rb"/([A-Za-z0-9#_+\-.]+)\s+(\d+)\s+0\s+R", font_dict):
        fdict = pdf.dict_of(int(num))
        tu = resolve(fdict, b"ToUnicode")
        fonts[name.decode("latin-1")] = {
            "map": parse_tounicode(pdf.stream_of(tu)) if tu else {},
            "two_byte": b"/Type0" in fdict or b"/IdentityHK" in fdict,
        }
    return content, fonts


def scan(content, fonts):
    runs = []
    cards = []
    color = None
    pts = []
    font = None
    size = 0.0
    tm = [1, 0, 0, 1, 0, 0]
    stack = []

    for tok in tokens(content):
        c = tok[:1]
        if c in b"/<[(+-." or c.isdigit():
            stack.append(tok)
            continue
        op = tok.decode("latin-1", "ignore")
        if op == "rg" and len(stack) >= 3:
            color = tuple(round(float(v), 4) for v in stack[-3:])
        elif op == "Tm" and len(stack) >= 6:
            tm = [float(v) for v in stack[-6:]]
        elif op == "Tf" and len(stack) >= 2:
            font = stack[-2][1:].decode("latin-1")
            size = float(stack[-1])
        elif op in ("m", "l") and len(stack) >= 2:
            pts.append((float(stack[-2]), float(stack[-1])))
        elif op == "c" and len(stack) >= 6:
            pts.append((float(stack[-2]), float(stack[-1])))
        elif op in ("f", "f*"):
            if pts and color:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                if 40 <= max(xs) - min(xs) <= 62 and 30 <= max(ys) - min(ys) <= 46:
                    cards.append((color, min(xs), min(ys), max(xs), max(ys)))
            pts = []
        elif op == "n":
            pts = []
        elif op in ("Tj", "TJ"):
            items = stack if op == "TJ" else [stack[-1]]
            info = fonts.get(font, {"map": {}, "two_byte": False})
            table = info["map"]
            for it in items:
                if it[:1] != b"(":
                    continue
                bs = unescape_literal(it[1:-1])
                codes = (
                    [int.from_bytes(bs[i:i + 2], "big") for i in range(0, len(bs) - 1, 2)]
                    if info["two_byte"] else list(bs)
                )
                text = "".join(table.get(cd, "") for cd in codes)
                runs.append((round(tm[4], 2), round(tm[5], 2), font, size, text))
        stack = []
    return runs, cards


def main():
    content, fonts = load(PDF_PATH)
    runs, cards = scan(content, fonts)

    # Words: group CJK-font runs that share an origin.
    groups = collections.OrderedDict()
    for x, y, font, size, text in runs:
        if font.startswith("F3") and text:
            groups.setdefault((x, y), []).append(text)
    words = [(k[0], k[1], "".join(v)) for k, v in groups.items()]

    # Level colour per card cell.
    by_row = collections.defaultdict(list)
    for color, x0, y0, x1, y1 in cards:
        row = round((6069.45 - y1) / 40)
        by_row[row].append((x0, x1, color))

    level_of_color = {
        (1.0, 0.7529, 0.0): 1,
        (0.3059, 0.5843, 0.851): 2,
        (1.0, 0.2, 0.0): 3,
        (0.7529, 0.0, 0.0): 4,
        (0.0, 0.1255, 0.3765): 5,
        (0.4392, 0.1882, 0.6275): 6,
        (0.3059, 0.6549, 0.1804): 7,
    }

    rows = []
    unmatched = 0
    for x, y, text in words:
        row = round((6069.45 - y) / 40)
        col = None
        level = None
        for x0, x1, color in by_row.get(row, []):
            if x0 - 1.5 <= x <= x1 + 1.5:
                col = round((x0 - 100.55) / 52)
                level = level_of_color.get(color)
                break
        if level is None:
            unmatched += 1
        rows.append({"x": x, "y": y, "row": row, "col": col, "level": level, "word": text})

    print("words", len(rows), "unmatched level", unmatched)
    print("per level", collections.Counter(r["level"] for r in rows))
    json.dump({"words": rows, "cards": cards},
              open("tools/parsed.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)


if __name__ == "__main__":
    main()
