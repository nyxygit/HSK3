"""Minimal PDF text extractor tailored for the ReportLab-generated HSK 3.0 sheet.

Parses the classic xref table, decodes content streams (Flate / ASCII85+Flate),
resolves /Font resources and their /ToUnicode CMaps, then replays the text
operators to produce positioned text runs.
"""

import base64
import re
import sys
import zlib


class PDF:
    def __init__(self, path):
        self.data = open(path, "rb").read()
        self.offsets = {}
        self._parse_xref()
        self.cache = {}

    # ---------------------------------------------------------------- xref
    def _parse_xref(self):
        tail = self.data[-2048:]
        m = re.search(rb"startxref\s+(\d+)", tail)
        if not m:
            raise RuntimeError("no startxref")
        pos = int(m.group(1))
        seen = set()
        while pos and pos not in seen:
            seen.add(pos)
            if self.data[pos:pos + 4] != b"xref":
                raise RuntimeError("bad xref at %d" % pos)
            end = self.data.index(b"trailer", pos)
            table = self.data[pos + 4:end].decode("latin-1")
            lines = [l.strip() for l in table.splitlines() if l.strip()]
            i = 0
            while i < len(lines):
                if re.match(r"^\d+\s+\d+$", lines[i]):
                    first, count = (int(x) for x in lines[i].split())
                    i += 1
                    for n in range(count):
                        parts = lines[i].split()
                        if len(parts) >= 3 and parts[2] == "n":
                            self.offsets[first + n] = int(parts[0])
                        i += 1
                else:
                    i += 1
            tm = re.search(rb"/Prev\s+(\d+)", self.data[end:end + 600])
            pos = int(tm.group(1)) if tm else 0

    def obj_at(self, num):
        if num in self.cache:
            return self.cache[num]
        off = self.offsets.get(num)
        if off is None:
            return None
        body = self.data[off:]
        m = re.match(rb"\s*(\d+)\s+(\d+)\s+obj", body)
        if not m:
            return None
        start = m.end()
        # dictionary / stream
        sm = re.search(rb"stream\r?\n|stream\r", body)
        em = body.find(b"endobj")
        if sm and (em == -1 or sm.start() < em):
            dic = body[start:sm.start()]
            b = sm.end()
            raw = None
            lm = re.search(rb"/Length\s+(\d+)(?:\s+0\s+R)?", dic)
            if lm and not dic[lm.start():lm.end()].endswith(b"R"):
                raw = body[b:b + int(lm.group(1))]
            if raw is None:
                e = body.find(b"endstream", b)
                raw = body[b:e]
            self.cache[num] = (dic, raw)
        else:
            self.cache[num] = (body[start:em], None)
        return self.cache[num]

    def dict_of(self, num):
        o = self.obj_at(num)
        return o[0] if o else b""

    def stream_of(self, num):
        o = self.obj_at(num)
        if not o:
            return None
        dic, raw = o
        if raw is None:
            return None
        if b"ASCII85Decode" in dic:
            payload = bytes(re.sub(rb"\s", b"", raw))
            if payload.endswith(b"~>"):
                payload = payload[:-2]
            raw = base64.a85decode(payload)
        if b"FlateDecode" in dic:
            raw = zlib.decompress(raw)
        return raw


def parse_tounicode(cmap_bytes):
    text = cmap_bytes.decode("latin-1")
    table = {}

    def u(hexstr):
        b = bytes.fromhex(hexstr)
        try:
            return b.decode("utf-16-be")
        except Exception:
            return ""

    for block in re.findall(r"beginbfchar(.*?)endbfchar", text, re.S):
        for src, dst in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", block):
            table[int(src, 16)] = u(dst)
    for block in re.findall(r"beginbfrange(.*?)endbfrange", text, re.S):
        for m in re.finditer(
            r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])", block
        ):
            lo, hi, dst = int(m.group(1), 16), int(m.group(2), 16), m.group(3)
            if dst.startswith("["):
                items = re.findall(r"<([0-9A-Fa-f]*)>", dst)
                for k, item in enumerate(items):
                    if lo + k <= hi:
                        table[lo + k] = u(item)
            else:
                base = dst[1:-1]
                if not base:
                    continue
                n = len(base) // 4
                prefix = bytes.fromhex(base[: max(0, len(base) - 4)]).decode(
                    "utf-16-be", "ignore"
                ) if n > 1 else ""
                low = int(base[-4:], 16) if n >= 1 else 0
                for k in range(hi - lo + 1):
                    table[lo + k] = prefix + chr(low + k)
    return table


def resolve(dic_bytes, key):
    m = re.search(rb"/" + key + rb"\s+(\d+)\s+0\s+R", dic_bytes)
    return int(m.group(1)) if m else None


TOKEN = re.compile(
    rb"(\[|\]|<<|>>|/(?:[^\s/<>\[\](){}%]*)|<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\()])*\)|[-+]?\d*\.?\d+|[A-Za-z'\"*]+)"
)


def tokens(stream):
    for m in TOKEN.finditer(stream):
        yield m.group(1)


def unescape_literal(s):
    out = bytearray()
    i = 0
    while i < len(s):
        c = s[i:i + 1]
        if c == b"\\":
            nxt = s[i + 1:i + 2]
            mapping = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f",
                       b"(": b"(", b")": b")", b"\\": b"\\"}
            if nxt in mapping:
                out += mapping[nxt]
                i += 2
                continue
            om = re.match(rb"[0-7]{1,3}", s[i + 1:])
            if om:
                out.append(int(om.group(0), 8) & 0xFF)
                i += 1 + len(om.group(0))
                continue
            i += 2
            continue
        out += c
        i += 1
    return bytes(out)


def extract(path):
    pdf = PDF(path)
    page = None
    for num in sorted(pdf.offsets):
        dic = pdf.dict_of(num)
        if b"/Type /Page" in dic and b"/Contents" in dic:
            page = num
            break
    page_dic = pdf.dict_of(page)
    contents = resolve(page_dic, b"Contents")
    res = page_dic[page_dic.find(b"/Resources"):]
    font_dict_num = resolve(res, b"Font")
    font_dict = pdf.dict_of(font_dict_num)

    fonts = {}
    for name, num in re.findall(rb"/([A-Za-z0-9#_+\-.]+)\s+(\d+)\s+0\s+R", font_dict):
        fdict = pdf.dict_of(int(num))
        tu = resolve(fdict, b"ToUnicode")
        fonts[name] = {
            "dict": fdict,
            "tounicode": parse_tounicode(pdf.stream_of(tu)) if tu else {},
            "two_byte": b"/Type0" in fdict or b"/Identity-H" in fdict,
        }

    content = pdf.stream_of(contents)
    runs = []
    stack = []
    font = None
    size = 10.0
    tm = [1, 0, 0, 1, 0, 0]
    tlm = list(tm)
    leading = 0.0

    def show(bs):
        nonlocal tm
        if font is None:
            return
        info = fonts.get(font)
        table = info["tounicode"] if info else {}
        two = info["two_byte"] if info else False
        if two:
            codes = [int.from_bytes(bs[i:i + 2], "big") for i in range(0, len(bs) - 1, 2)]
        else:
            codes = list(bs)
        text = "".join(table.get(c, chr(c) if 32 <= c < 127 else "") for c in codes)
        if text.strip():
            runs.append({
                "x": tm[4], "y": tm[5], "size": abs(size),
                "text": text, "font": font.decode("latin-1", "ignore"),
            })

    for tok in tokens(content):
        if tok[:1] in b"/<[(+-." or tok[:1].isdigit():
            stack.append(tok)
            continue
        op = tok.decode("latin-1", "ignore")
        if op == "BT":
            tm = [1, 0, 0, 1, 0, 0]
            tlm = list(tm)
        elif op == "Tf":
            if len(stack) >= 2:
                font = stack[-2][1:]
                size = float(stack[-1])
        elif op == "TL":
            leading = float(stack[-1])
        elif op == "Tm":
            nums = [float(v) for v in stack[-6:]]
            tm = nums
            tlm = list(nums)
        elif op in ("Td", "TD"):
            tx, ty = float(stack[-2]), float(stack[-1])
            if op == "TD":
                leading = -ty
            tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + tx * tlm[0], tlm[5] + ty * tlm[3]]
            tm = list(tlm)
        elif op == "T*":
            tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4], tlm[5] - leading]
            tm = list(tlm)
        elif op == "Tj":
            if stack and stack[-1][:1] == b"(":
                show(unescape_literal(stack[-1][1:-1]))
        elif op == "TJ":
            for item in stack:
                if item[:1] == b"(":
                    show(unescape_literal(item[1:-1]))
                elif item[:1] == b"<":
                    show(bytes.fromhex(re.sub(rb"\s", b"", item[1:-1]).decode("latin-1")))
        elif op == "Tj" or op == "'" or op == '"':
            pass
        stack = []
    return runs


if __name__ == "__main__":
    runs = extract(sys.argv[1])
    print("runs:", len(runs))
    for r in runs[:40]:
        print(round(r["x"], 1), round(r["y"], 1), round(r["size"], 1), r["font"], repr(r["text"]))
