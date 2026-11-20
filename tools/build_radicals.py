"""Build radicals.js from the strokeorder.com radical index.

The page lists 239 radicals grouped by stroke count but carries no readings, so
each radical is enriched with pinyin and a short English gloss from CC-CEDICT.

Sources:
  https://www.strokeorder.com/category/radical   (radical list, stroke groups)
  CC-CEDICT, CC BY-SA 4.0 — https://cc-cedict.org/   (readings and meanings)
"""

import json
import os
import re
import unicodedata

HERE = os.path.dirname(__file__)
TMP = os.path.join(os.environ["TEMP"], "hsk-defs")
HTML = os.path.join(TMP, "radicals.html")
CEDICT = os.path.join(TMP, "cedict.txt")
OUT = os.path.join(HERE, "..", "radicals.js")

LINE = re.compile(r"^(\S+) (\S+) \[([^\]]+)\] /(.*)/$")
SECTION = re.compile(r'id="bushou-(\d+)"(.*?)(?=id="bushou-\d+"|$)', re.S)
CHIP = re.compile(r'href="/category/radical/([^"]+)"[^>]*>([^<]+)<')
KANGXI = re.compile(r"Kangxi radical (\d+)", re.I)
SYLLABLE = re.compile(r"^([A-Za-z\u00fc:]+)([1-5]?)$")
CJK = re.compile(r"[\u3400-\u9fff]")

MARKS = {"1": "\u0304", "2": "\u0301", "3": "\u030c", "4": "\u0300"}

SKIP = ("variant of", "old variant", "archaic variant", "used in", "see also",
        "surname ", "abbr. for", "erhua variant", "name of")

FALLBACK = {
    "乚": "乙", "阝": "阜", "耂": "老", "肀": "聿", "牜": "牛", "礻": "示",
    "钅": "金", "覀": "西", "車": "车", "飠": "食", "麥": "麦", "黽": "黾",
}

# CC-CEDICT carries the classical Kangxi reading for several radicals, and picks
# a rare reading for a few common characters. These are the readings a
# simplified-Chinese learner is taught (cross-checked against the primary-school
# 部首表: 一 横, 丨 竖, 丿 撇, 丶 点, 乙 折 …).
# Rule of thumb: shapes that are not words get their stroke/component name;
# radicals that are ordinary characters keep their normal reading.
# Format: char: (pinyin, gloss)
NAME_OVERRIDES = {
    "丨": ("shù", "vertical stroke"),
    "丿": ("piě", "slash (left-falling stroke)"),
    "乛": ("zhé", "turn (horizontal, then down)"),
    "丶": ("diǎn", "dot"),
    "亅": ("shù gōu", "vertical hook"),
    "乚": ("shù wān gōu", "vertical bend hook"),
    "厂": ("chǎng", "cliff radical"),
    "广": ("guǎng", "broad / shelter radical"),
    "石": ("shí", "stone"),
    "疒": ("bìng", "sickness radical"),
    "厶": ("sī", "private"),
}


def tone_mark(syllable):
    """'dan1' -> 'dān', 'nv3' -> 'nǚ', 'de5' -> 'de'."""
    m = SYLLABLE.match(syllable)
    if not m:
        return syllable
    letters = m.group(1).lower().replace("u:", "ü").replace("v", "ü")
    tone = m.group(2) or "5"
    if "a" in letters:
        idx = letters.index("a")
    elif "e" in letters:
        idx = letters.index("e")
    elif "o" in letters:
        idx = letters.index("o")
    else:
        idx = -1
        for i in range(len(letters) - 1, -1, -1):
            if letters[i] in "iuü":
                idx = i
                break
    if tone in MARKS and idx >= 0:
        letters = letters[: idx + 1] + MARKS[tone] + letters[idx + 1:]
    return unicodedata.normalize("NFC", letters)


def read_pinyin(py):
    return " ".join(tone_mark(tok) for tok in py.split())


def load_cedict():
    entries = {}
    with open(CEDICT, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            m = LINE.match(line.strip())
            if not m:
                continue
            _trad, simp, py, defs = m.groups()
            entries.setdefault(simp, []).append((py, [d for d in defs.split("/") if d]))
    return entries


def tidy(d):
    d = re.sub(r"\[[^\]]*\]", "", d)                                   # [cao3 zi4 tou2]
    d = re.sub(r"([\u3400-\u9fff]+)\|([\u3400-\u9fff]+)", r"\2", d)   # 草|草 -> 草
    return d.strip(" ;,")


def gloss(defs):
    # 1) quoted radical name:  "one" radical in Chinese characters ...
    for d in defs:
        m = re.search(r'"([^"]+)"\s+radical', d)
        if m:
            return m.group(1) + " radical"
    # 2) a descriptive radical gloss (person radical, grass radical, ...)
    for d in defs:
        low = d.lower()
        if "radical" not in low:
            continue
        if low.startswith("radical in chinese characters") or low.startswith("kangxi radical"):
            continue
        d2 = tidy(d)
        cut = d2.lower().find("radical")
        if cut != -1 and CJK.search(d2[cut:]):
            d2 = d2[: cut + len("radical")]
        return d2.split(";")[0][:60]
    # 3) the usual first sense (generic radical filler is not a meaning)
    keep = [d for d in defs if not d.lower().startswith(SKIP)]
    pick_def = tidy(keep[0] if keep else (defs[0] if defs else ""))
    pick_def = pick_def.split(";")[0].strip()
    if pick_def.lower().startswith(("radical in chinese characters", "kangxi radical")):
        return ""
    if len(pick_def) > 42:
        pick_def = pick_def[:42].rsplit(" ", 1)[0] + "…"
    return pick_def


def rank(item):
    """Prefer entries that describe the radical, not a surname or variant."""
    py, defs = item
    low = [d.lower() for d in defs]
    score = 0
    if any("radical" in d for d in low):
        score += 5
    if py and py[0].isupper():
        score -= 4
    if any(d.startswith("surname ") or d.startswith(SKIP) for d in low):
        score -= 3
    return -score


def main():
    html = open(HTML, encoding="utf-8").read()
    cedict = load_cedict()

    radicals = []
    seen = set()
    for stroke, body in SECTION.findall(html):
        for _href, char in CHIP.findall(body):
            char = char.strip()
            if not char or char in seen:
                continue
            seen.add(char)

            cands = cedict.get(char) or []
            note = ""
            if not cands and char in FALLBACK:
                base = FALLBACK[char]
                cands = cedict.get(base) or []
                note = "form of " + base

            py, meaning, kangxi = "", "", 0
            if cands:
                best = sorted(cands, key=rank)[0]
                py = read_pinyin(best[0])
                meaning = gloss(best[1])
                if meaning.startswith("radical in Chinese characters"):
                    meaning = ""
                for _p, defs in cands:
                    for d in defs:
                        m = KANGXI.search(d)
                        if m:
                            kangxi = int(m.group(1))
                            break
                    if kangxi:
                        break

            if char in NAME_OVERRIDES:
                py, meaning = NAME_OVERRIDES[char]

            if note and char not in NAME_OVERRIDES:
                meaning = (meaning + " · " if meaning else "") + note

            m = CJK.search(meaning)              # keep glosses English
            if m and m.start() > 0:
                cut = meaning[: m.start()].rstrip(" ·,")
                if not cut.lower().endswith(("of", "a", "the", "·")):
                    meaning = cut

            radicals.append({
                "r": char,
                "s": int(stroke),
                "p": py,
                "m": meaning,
                "k": kangxi,
            })

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("/* 239 radicals: list from strokeorder.com; readings and glosses from CC-CEDICT (CC BY-SA 4.0) */\n")
        fh.write("window.HSK_RADICALS = ")
        json.dump(radicals, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")

    print("radicals", len(radicals))
    print("without reading", sum(1 for r in radicals if not r["p"]))
    print("without gloss", sum(1 for r in radicals if not r["m"]))
    print("bytes", os.path.getsize(OUT))
    for r in radicals[:6]:
        print(" ", r)


if __name__ == "__main__":
    main()
