# Prompt: recording transcript → comic JSON

Paste everything between the two lines into an AI chat, fill in the three values at the top, and paste the transcript at the bottom.
The answer is the JSON for the editor's step 3. The checks in the editor tab will flag anything that still doesn't fit.

---

You turn a spoken recording transcript into the JSON that drives a comic-bubble video edit. Follow these rules exactly and output only what is asked at the end.

DANCER NAME: <the name for the name bubble, e.g. Stella Revheim>
VIDEO FILE: <the video's file name, e.g. stella.mp4, or leave as video.mp4>
GRID: 20x20 (columns A to T from left to right, rows 1 to 20 from top to bottom, so cells go from A1 to T20)

## What the speaker says

The transcript is a list of spoken markers, in order:

- `Target cell <CELL>, time <TIME>.` starts a new bubble whose tail points at CELL and whose words appear at TIME.
- `Action, <words>.` gives the words for the most recent target. If several actions follow one target, join them into one text with ", " (example: "bend head down, hand to chest").
- `Name bubble.` means the NEXT target is the name bubble. Its words are the DANCER NAME, not an action.
- `And.` between two targets means both are the same bubble with two tails: one bubble, both cells, at the first target's time. The action after the second target gives the words.
- `Impact, cell <CELL>, time <TIME>.` (optionally followed by `until <TIME>`) puts an impact burst at CELL at TIME. It is not a bubble.
- Ignore everything else: player text like "Play", "Mute", "Settings", "00:00", the recording's file name, filler words.

## Fixing what speech-to-text gets wrong

- Times: the speaker always says seconds with three decimals. Speech-to-text sometimes adds or moves dots ("1.0262", "1.0.900", "1.1.363"). Fix every time like this: take all its digits, the LAST THREE are the thousandths and the rest are whole seconds. So "1.0262" → 10.262, "1.0.900" → 10.900, "1.1.363" → 11.363, "0.965" → 0.965, "7.560" → 7.56.
- Times must go up through the recording. If a fixed time is still lower than the one before, keep it but list it under Notes.
- Cells: a letter A–T plus a number 1–20. Letters may come out spelled as they sound: eff→F, bee→B, see/sea→C, dee→D, ee→E, gee→G, aitch→H, eye→I, jay→J, kay→K, el→L, em→M, en→N, oh→O, pee→P, cue→Q, ar/are→R, ess→S, tee→T. So "EFF13" → F13. A cell outside A1–T20 is a mistake: list it under Notes and leave that bubble out.

## Building the bubbles ("captions")

- One caption per bubble, in time order, ids 1, 2, 3, ... in that order. The name bubble is caption id 1.
- `text`: the action words, lower case, without a full stop. For the name bubble: the DANCER NAME as written above.
- `cells`: the target cell, or both cells for an `And.` pair.
- `from`: the fixed time. `to`: from + 0.2, but at most the next caption's from − 0.01.
- `mode`: always "center". `out`: always "default".
- A target that never gets an action (and is not the name bubble) has no words: leave it out and list it under Notes.
- Two targets with the same cell and the same time are one bubble: join their actions with ", ".
- Two bubbles at the same time on different cells without `And.`: make them one bubble with both cells, and list it under Notes.

## Impacts

Every `Impact` marker becomes `{"cell": CELL, "from": TIME}` in `impact.at` (add `"to": TIME` when "until" was said), in time order.
Always write `"captions": []` inside `impact`, so the only bursts are the ones that were said.

## Output

Output exactly this, with the captions and impacts filled in, in one ```json code block:

```json
{
  "version": 1,
  "video": {"file": "<VIDEO FILE>"},
  "grid": {"size": 20},
  "fps": 30,
  "style": {
    "type": "comic-bubble",
    "fill": "#FFFFFF",
    "ink": "#000000",
    "font": {"family": "Comic Neue", "weight": 700, "sizeCells": 0.4, "capitals": true},
    "outlineCells": 0.05,
    "ballRadiusCells": 0.25,
    "tail": {"enabled": true, "defaultTarget": "J10", "maxLengthCells": 1.8, "reach": 0.6}
  },
  "timing": {
    "exitFadeSeconds": 0.05, "gapBeforeNextSeconds": 0.5, "lastHoldSeconds": 0.6,
    "firstBallPopSeconds": 0.15, "firstOpenSeconds": 0.15, "endCloseSeconds": 0.15, "endShrinkSeconds": 0.15,
    "split": {"close": 0.25, "travel": 0.5, "open": 0.25}
  },
  "captions": [
    {"id": 1, "text": "<DANCER NAME>", "from": 0.965, "to": 1.165, "cells": ["J6"], "mode": "center", "out": "default"}
  ],
  "impact": {"size": 1.5, "captions": [], "at": []},
  "zooms": [],
  "ending": []
}
```

After the code block, write a short **Notes** list of everything you fixed or left out (times you corrected, cells you corrected, targets without an action, merged bubbles), or "Notes: none".

## Example

Transcript:
"Name bubble. Target cell J6, time 0.965. Target cell I12, time 3.936. Action, bend head down. Action, hand to chest. Target cell G7, time 7.560. And. Target cell O9, time 7.560. Action, lock hands. Target cell EFF13, time 8.668. Action, kick to the left. Impact, cell F13, time 8.700. Target cell D17, time 1.0262. Target cell E10, time 1.0.900. Action, hands forward."

Captions and impacts:
```json
"captions": [
  {"id": 1, "text": "Stella Revheim", "from": 0.965, "to": 1.165, "cells": ["J6"], "mode": "center", "out": "default"},
  {"id": 2, "text": "bend head down, hand to chest", "from": 3.936, "to": 4.136, "cells": ["I12"], "mode": "center", "out": "default"},
  {"id": 3, "text": "lock hands", "from": 7.56, "to": 7.76, "cells": ["G7", "O9"], "mode": "center", "out": "default"},
  {"id": 4, "text": "kick to the left", "from": 8.668, "to": 8.868, "cells": ["F13"], "mode": "center", "out": "default"},
  {"id": 5, "text": "hands forward", "from": 10.9, "to": 11.1, "cells": ["E10"], "mode": "center", "out": "default"}
],
"impact": {"size": 1.5, "captions": [], "at": [{"cell": "F13", "from": 8.7}]}
```
Notes: "EFF13" read as F13. Times "1.0262" → 10.262 and "1.0.900" → 10.9. Target D17 at 10.262 had no action and was left out.

TRANSCRIPT:
<paste the transcript here>

---
