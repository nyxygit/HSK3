"""Attach English glosses (from CC-CEDICT) to the poster's 11,000 cards.

Matching aligns the dictionary's spaced syllables against our (sometimes
spaceless) pinyin and compares tones, so polyphonic words pick the right sense
(吧 ba5 "particle", not 吧 ba1 "bar"; 孙子 sūnzi "grandson", not Sun Tzu).

CC-CEDICT is CC BY-SA 4.0 — https://cc-cedict.org/
Writes defs.js: window.HSK_DEFS, aligned with the poster grid (null = no card).
"""

import json
import os
import re
import unicodedata

CEDICT = os.path.join(os.environ["TEMP"], "hsk-defs", "cedict.txt")
GRID = os.path.join(os.path.dirname(__file__), "grid.json")
OUT = os.path.join(os.path.dirname(__file__), "..", "defs.js")

LINE = re.compile(r"^(\S+) (\S+) \[([^\]]+)\] /(.*)/$")
PARENS = re.compile(r"[（(][^）)]*[）)]")
TONE_MARKS = {"\u0304": "1", "\u0301": "2", "\u030c": "3", "\u0300": "4"}
HAN = r"[\u3400-\u9fff]"

SKIP = ("variant of", "old variant", "archaic variant", "used in", "see also",
        "surname ", "abbr. for", "erhua variant", "name of ")


def _clean_pinyin(s):
    return s.replace("u:", "v").replace("ü", "v")


def tone_letters(s):
    """'sūnzi' -> ('sunzi', {1: '1'}); also handles 'nǚ' -> ('nv', {0: '3'})."""
    letters, tones = [], {}
    for ch in unicodedata.normalize("NFD", _clean_pinyin(s)):
        if ch in TONE_MARKS:
            if letters:
                tones[len(letters) - 1] = TONE_MARKS[ch]
            continue
        if ch == "\u0308":
            continue
        if ch.isalpha():
            letters.append(ch.lower())
    return "".join(letters), tones


def numeric_syllables(py):
    """CC-CEDICT 'sun1 zi5' -> [('sun','1'), ('zi','5')]."""
    out = []
    for token in py.split():
        m = re.match(r"^([a-zA-Z:]+)([1-5]?)$", token)
        if not m:
            return None
        letters = _clean_pinyin(m.group(1)).replace(":", "")
        out.append((letters.lower(), m.group(2) or "5"))
    return out


def tone_matches(ours, cand_pinyin):
    sylls = numeric_syllables(cand_pinyin)
    if not sylls:
        return False
    plain_ours, tones = tone_letters(ours)
    if "".join(s for s, _ in sylls) != plain_ours:
        return False
    pos = 0
    for letters, tone in sylls:
        marks = {tones[i] for i in range(pos, pos + len(letters)) if i in tones}
        if tone == "5":
            if marks:
                return False
        elif marks != {tone}:
            return False
        pos += len(letters)
    return True


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
    d = re.sub(HAN + r"+" + r"\|(" + HAN + r"+)", r"\1", d)   # 孫武|孙武 -> 孙武
    d = re.sub(r"\[[^\]]*\]", "", d)                          # [Sun1 Wu3]
    d = re.sub(r"\s*CL:[^;]*$", "", d)                        # classifier tail
    d = re.sub(r"\s*\([^)]*\)\s*$", "", d)                    # trailing note
    d = re.sub(r"\s{2,}", " ", d)
    return d.strip(" ;,")


def gloss(defs):
    keep = [d for d in defs if not d.lower().startswith(SKIP)]
    if not keep:
        keep = defs[:1]
    cleaned = [t for t in (tidy(d) for d in keep) if t]
    if not cleaned:
        cleaned = [defs[0].strip(" ;,")]
    text = "; ".join(cleaned[:2])
    if len(text) > 110:
        cut = text[:110]
        text = cut[: cut.rfind(" ")] + "…"
    return text


def main():
    cedict = load_cedict()
    grid = json.load(open(GRID, encoding="utf-8"))

    out = []
    exact = toneless = fuzzy = missing = 0
    missing_words = []

    for row in grid:
        line = []
        for cell in row:
            if cell is None:
                line.append(None)
                continue
            hz, py = cell["h"], cell["p"]
            cands = cedict.get(hz)
            if not cands:
                alt = PARENS.sub("", hz)
                cands = cedict.get(alt) or (cedict.get(alt + "儿") if alt else None)
            if not cands:
                missing += 1
                missing_words.append(hz)
                line.append(None)
                continue

            # prefer the everyday reading over a proper-noun one (Qi2 vs qi2)
            ordered = sorted(cands, key=lambda x: any(c.isupper() for c in x[0]))
            defs = None
            for py_c, d in ordered:
                if tone_matches(py, py_c):
                    defs = d
                    break
            if defs is not None:
                exact += 1
            else:
                wanted = tone_letters(py)[0]
                for py_c, d in ordered:
                    if tone_letters(py_c)[0] == wanted:
                        defs = d
                        break
                if defs is not None:
                    toneless += 1
                else:
                    defs = cands[0][1]
                    fuzzy += 1
            line.append(gloss(defs))
        out.append(line)

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("/* English glosses from CC-CEDICT (CC BY-SA 4.0) — https://cc-cedict.org/ */\n")
        fh.write("window.HSK_DEFS = ")
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")

    total = exact + toneless + fuzzy + missing
    print("words", total, "tone-exact", exact, "toneless", toneless,
          "any-reading", fuzzy, "missing", missing)
    print("missing", missing_words[:10])
    print("bytes", os.path.getsize(OUT))
    print("empty glosses", sum(1 for row in out for d in row if d is not None and not d))


if __name__ == "__main__":
    main()
