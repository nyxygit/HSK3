# HSK 3.0 · Vocabulary map

An interactive map of all **11,000 words** from the *HSK 3.0 · Vocabulario
visualizado* poster, built to tick off the ones you already know.

Open **`index.html`** (double-click). No server, no install: it works offline and
keeps your progress in the browser.

Three pages live behind the floating icons on the left: **Characters** (the map,
the default), **Radicals** and **Quiz**.

## Using it

| Action | Result |
| --- | --- |
| Click a card | opens it large, with its pinyin and English translation (no colour change) |
| **Quick mark** switch on | clicks mark cards instead of opening them: grey → **yellow** (to write) → **green** (known) → grey |
| Press and hold a card | opens the large card even in quick-mark mode |
| Drag | move around the map |
| Scroll / pinch | zoom in and out, centred on the cursor |
| `+` `−` `0` | zoom in, zoom out, show everything |
| Level chips (bottom) | fly to that level |
| Minimap (top right) | click to jump to an area |
| Search | hanzi or tone-less pinyin; `Enter` jumps to the next match |
| **Pinyin** switch | hides or shows pinyin on every card |
| `↺` | clears every mark |

Three colours, three meanings: **grey** untouched, **yellow** still learning to
write, **green** known. The progress bar at the top shows both marked shares.

The opened card is also the review panel: **Known** and **To write** set the
colour and close it again (`1` and `2` on the keyboard do the same). `Esc`, the ×
or a click outside closes it without marking.

Progress is saved automatically (`localStorage`) and restored on the next visit,
along with the last position and the state of both switches.
Zooming is level-of-detail: far out, cards are drawn as plain colour blocks
(unmarked ones tinted with their level colour) and the text is skipped; as you
zoom in, hanzi appear, then pinyin. Only the cards inside the viewport are
painted, so panning and zooming stay smooth over the whole 11,000-card map.

## Radicals

All **239 radicals** from the [strokeorder.com radical
index](https://www.strokeorder.com/category/radical), grouped by stroke count
(1–15) with a filter row. Each card shows the radical, its reading, a short
English gloss and the stroke count. The readings and glosses come from
CC-CEDICT; twelve variant forms (亻, 氵, 扌, 钅…) borrow the reading of the
character they are a form of.

Click a radical to mark it like a word card: grey → green (known) → red (to
review) → grey. Radical marks are stored under their own key (`hsk3.rad.v1`) and
feed the radical quiz.

A few shapes are taught under a different name than the dictionary's classical
Kangxi reading — or the dictionary picks a rare reading of a common character —
so `tools/build_radicals.py` overrides them, following a primary-school
部首表: **丨 shù**, **丶 diǎn**, **丿 piě**, **亅 shù gōu**, **乚 shù wān gōu**,
**乛 zhé**, **厂 chǎng**, **广 guǎng** (not *yǎn*), **石 shí** (not *dàn*),
**疒 bìng** (not *nè*), **厶 sī** (not *mǒu*). Add more entries to
`NAME_OVERRIDES` there if your course uses other names.

Radicals that are also ordinary characters keep their normal reading (一 yī,
乙 yǐ, 人 rén, 口 kǒu…); component forms keep their short reading (氵 shuǐ,
扌 shǒu, 亻 rén), which is the key syllable of the full name (三点水 sān diǎn shuǐ).

## Quiz

The switcher at the top of the page picks what to study:

- **Characters** — draws from the words marked **To write** (yellow) and shows the
  hanzi; **Reveal** adds the pinyin and English meaning.
- **Writing** — the same yellow cards, the other way round: the prompt is the
  pinyin and meaning, so you write or recall the character; **Reveal** shows the
  character itself, with a **Stroke Order** link for each of its characters.
  The links target a single named tab (`strokeorder`), so the first click opens
  it and every later click navigates that same tab — handy when it is docked
  beside the app in a split screen. Close it and the next click opens a new one.
- **Radicals** — draws from the radicals marked **To review**. The card shows only
  the **pinyin name** of the radical, so you recall the shape; **Reveal** shows
  the stroke itself plus its meaning.
- **Full review** — a recap of everything you already **know**: it draws only from
  cards marked **Known** (green), and a small switch above the card chooses
  whether to **Recognise** (hanzi → pinyin + meaning) or **Write**
  (pinyin + meaning → hanzi). The choice is remembered.

Once the answer is shown, **Mark known** promotes that card to green (leaving the
current round) without going back to the map. **Next card** moves on, and when the
pool runs out it reshuffles and starts again. `Enter` (or space) does reveal/next.
Nothing is scored — it is a flashcard deck, not a test.

If nothing is marked for the chosen mode, the page explains what to mark and
links to the right page.

## How it was built

The PDF is a single 4050 × 6470 pt sheet holding a **75-column × 147-row** grid
of cards (64 × 50 pt cells). The seven HSK levels occupy fixed rectangles of
that grid, and words are read left to right, top to bottom **inside each level**,
in alphabetical pinyin order:

| Level | Words | Zone (columns × rows) |
| --- | --- | --- |
| 1 · 一级 | 300 | 0–24 × 0–11 |
| 2 · 二级 | 200 | 0–24 × 12–19 |
| 3 · 三级 | 500 | 0–24 × 20–39 |
| 4 · 四级 | 1,000 | 25–49 × 0–39 |
| 5 · 五级 | 1,600 | 0–49 × 40–71 |
| 6 · 六级 | 1,800 | 50–74 × 0–71 |
| 7–9 · 七–九级 | 5,600 | 0–74 × 72–146 |

The app reproduces that grid exactly, so the reading order matches the printed
sheet (same hanzi, same pinyin, same relative position).

The data was extracted from the PDF with the small reader in `tools/` (xref
parser, Flate / ASCII85 streams, the embedded fonts' `ToUnicode` maps, and the
card geometry). The poster itself has no translations, so the English glosses
come from **CC-CEDICT**: each card is matched by hanzi and, where possible, by
syllable-level tone-aware pinyin (so 吧 `ba5` gets "particle", not "bar").
10,998 of the 11,000 words matched; two rare ones have no entry.

```powershell
python tools\make_grid.py      # hanzi + pinyin + grid -> tools\grid.json
python tools\make_datajs.py    # writes data.js for the app
python tools\build_defs.py     # CC-CEDICT glosses -> defs.js
python tools\build_radicals.py # radical index + CC-CEDICT -> radicals.js
```

## Files

- `index.html` — page shell
- `styles.css` — top bar, HUD, minimap, level colours, focused card, pages
- `app.js` — canvas renderer, camera (zoom/pan), marks, search, pages, quiz
- `data.js` — the 11,000 cards (`hanzi|pinyin`) laid out on the poster grid
- `defs.js` — English glosses, aligned with the grid
- `radicals.js` — the 239 radicals with readings and glosses
- `tools/` — PDF extraction, dictionary and radical pipelines (not needed to use the app)
- `preview-*.png` — screenshots (map, focus card, radicals, both quizzes)

## Credits

- Vocabulary and layout: the *HSK 3.0 · Vocabulario visualizado* PDF this map was
  built from.
- Definitions: [CC-CEDICT](https://cc-cedict.org/), licensed CC BY-SA 4.0.
- Radical list: [strokeorder.com radical index](https://www.strokeorder.com/category/radical).
