# Mirrors mascot

- `src/mascot/mascot.js`: **the mascot itself**, one file: his look, animations and choreography rules, and `DEFAULTS`
  (Sarah's chosen settings). Used by both the Remotion "Mascot" style (`src/MascotLayer.tsx`) and the playground.
- `mascot/playground.src.js` + `mascot/playground.template.html`: the playground page's own controls.
- `mascot/playground.html`: the built playground (published as the Claude artifact). Rebuild after any change:
  `npm run mascot:playground`
- `mascot/settings.json`: the chosen settings (same as `DEFAULTS`).

In the editor: Bubble style = Mascot. Paste the playground's "Copy settings" into the box under it to override `DEFAULTS`
for one video (saved in the JSON as `"mascot"`).
