# CITY_NET browser tests (e2e)

The real app in a real browser: the backend and the frontend started fresh, and Playwright driving
them the way a GM and players would. Everything else in the repo is tested piece by piece; these
journeys check the pieces work together on screen.

## What a run does

- Starts its **own backend** on port **5055** and its **own frontend** on port **5174**. A dev setup
  already running on 5000 and 5173 is never touched, so you can run these while you work.
- Uses a **throwaway database** in your system's temp folder (`citynet-e2e-<time>.db`), made new
  for every run. Your real `backend/city.db` is never opened. Each run deletes the one before it, so
  at most one is ever left behind.
- Signs in with a **test-only GM** (`e2e_gm`), which exists only in that throwaway database. No real
  account or password is used. The player journey registers its own test player (`e2e_player`) the
  same way, in the same throwaway database.
- Runs in **Secure Mode**, as a real table does: everyone signs in.
- Drives **one headless browser**, one test at a time (the player journey opens a second, separate
  window in it for the player). Both servers are stopped when it finishes.

## Install (once)

You need Node.js 20 or later, and the backend's and frontend's own packages installed as usual
(`npm install` in `backend/` and in `frontend/`). Then, in this folder:

```bash
cd e2e
npm install
```

That installs only Playwright's test runner, a few megabytes.

**The browser.** On your own machine the tests use the **Google Chrome already installed**, so
nothing large is downloaded. If you don't have Chrome, install Playwright's own Chromium once
instead (about 150 MB):

```bash
npx playwright install chromium
```

and run with `E2E_CHROMIUM=1` set, which tells the tests to use it:

```bash
E2E_CHROMIUM=1 npm test
```

(In PowerShell: `$env:E2E_CHROMIUM=1; npm test`.)

## Run

```bash
cd e2e
npm test
```

A run takes under a minute and prints one line per journey. To run one file:

```bash
npx playwright test tests/builder-smoke.spec.ts
```

To watch it happen in a visible browser window:

```bash
npx playwright test --headed
```

To step through a journey one action at a time, with Playwright's inspector:

```bash
npx playwright test --debug
```

## When a test fails

- The list output says which step failed and why.
- A failed test keeps a **screenshot** and a **trace** in `test-results/`. Open the trace to see every
  step, the page at each one, and the network calls:

  ```bash
  npx playwright show-trace test-results/<the test's folder>/trace.zip
  ```

- In CI the same files, and an HTML report, are attached to the run as an artifact
  (**e2e-report**), downloadable from the run's summary page on GitHub.

## In CI

`.github/workflows/ci.yml` runs these on every pull request, in the **Browser Journeys** job, with
Playwright's own Chromium (`CI` is set there). They are part of the same check as the backend and
frontend suites.

## Writing a journey

- One file per journey in `tests/`, named `<what>.spec.ts`.
- Find things the way a person would: by role and name (`getByRole('button', { name: 'PUBLISH' })`),
  by placeholder or label. Avoid CSS selectors; the windows' names and buttons are what players see.
- Sign in with `GM` from `playwright.config.ts`. The database starts empty each run, so a journey
  makes what it needs (a system, a character) rather than expecting it to be there. What a journey
  is not about can be set up through the API (`runningSystem`, `approvedPlayer`); what it is about
  is done on screen.
- Two people at once: a second browser of their own with `browser.newContext({ baseURL })`, as the
  player journey does, so each has their own sign-in.
- The tests share one database and run in order, one at a time, files alphabetically. A journey that needs a
  fresh state (the tour unseen) sets it up through the API first, rather than counting on running first.
- In CI a failed journey is tried once more, on the same database, so a journey that makes something
  named gives the retry a name of its own (`Hearthfall 2`).
- The builder's rail widens over the page while the pointer is on it. Click it with `clickRail` (or
  `builderPage`), which moves the pointer back to the page after, as a person would.
- Put shared steps (signing in, opening the builder) in `tests/helpers.ts`.

## Files

| File | What it is |
| --- | --- |
| `playwright.config.ts` | Starts both servers on their own ports with the throwaway database and the test GM; one headless browser |
| `cleanup.ts` | Before a run, deletes the throwaway databases earlier runs left |
| `tests/helpers.ts` | Signing in as the GM or a player, opening the GAME tab and the builder (past the tour), a rail button clicked with the pointer moved off after, a builder page from the rail; and through the API, a system made, published and running, and a player registered and approved |
| `tests/builder-journey.spec.ts` | The GM builds a system from + NEW (words, a part off, a stat and a formula worked out on the sample), publishes it, changes it and publishes v2 through the version preview, and switches the game to it |
| `tests/builder-clicks.spec.ts` | Every control on every builder page, the rail, each STATS & RULES tab (DICE with dice made, a symbol's drawing pad and icons open; ROLLS with a Blades and a Vampire roll, all five steps and TEST ROLL showing, its condition switches too: a condition given ALL ROLLS −1 on CONDITIONS first; and a roll's panel on GRAPH), NPCS' TIERS tab, and STATS & RULES in GRAPH included, takes a click where a person would click it (the map's overlay lets the pointer through to the map wherever nothing claims it, which unit tests can't see); INSTALL A FILE opens the file picker when clicked and takes a dropped file |
| `fixtures/emberline.citysys` | A random system file for INSTALL A FILE, made by the test generator and exported the way the builder exports |
| `tests/builder-rolls.spec.ts` | STATS & RULES' ROLLS tab (6b1a): a roll made from a preset, named, rolled by a stats group, TEST ROLL on the server for a field with a change, then under HURT (6b3c, one less and named in the working) (with GRAPH_SHOTS=1, a picture of the tab into `docs/mockups/shots/`), and all of it kept after a reload; a roll on GRAPH (6b4a): its node with the wire from the stats list's own dot (with GRAPH_SHOTS=1, pictures of the node and its panel), its panel renaming it on the map, TEST ROLL there; + ADD → ROLL · BLADES ACTION, and the SKILLS list's own dot dragged onto it (6b4b); a roll's dice, reading, adding, bands and special results (exploding once, a natural) edited and TEST ROLL rolling it as edited |
| `tests/builder-dice.spec.ts` | STATS & RULES' DICE tab (6c2b2): dice made from GOOD / GREAT / BAD, a face given +2 and a HIT, HIT drawn on the pad with a real pointer stroke, four thrown by TEST on the server, one of the table's CUSTOM_DIE.EXE dice copied in (its SKULL a symbol), all of it kept after a reload (with GRAPH_SHOTS=1, a picture of the tab) |
| `tests/builder-graph.spec.ts` | STATS & RULES as a map (5a3a): a system drawn, a node dragged (undone with Ctrl+Z and done again with Ctrl+Y) and a group folded, all kept after a reload with GRAPH remembered, then FORMS showing the same system; a node clicked and edited in its panel, the map gaining the wire and the value, and FORMS the same; a wire drawn from a dot onto a formula, undone and done again, one cut and one that opens the panel instead, and FORMS with the formula they left; a modifier's diamond on its wire, its number changed in the panel and followed by the diamond, the value and FORMS; a table added with A where the GM is looking, removed with Delete and brought back with Ctrl+Z; a condition added with A, its IF, THEN and ELSE written in the panel, a wire into it asking to compare, and the same in FORMS; PROBLEMS on the map: a broken formula outlined red, picked from the list and moved to, fixed in its panel and gone once saved; TRY ON THE MAP: a house rule's formula swapped in for the map's numbers and wires only, never saved; hovering a node lighting what it reads and what reads it, its wires cyan, the rest faded and back when the pointer leaves; a formula put in a new group of its own from its panel, the group named from its title bar, shown in FORMS with EDIT IN GRAPH back to it, a second formula joining it and the two lined up, and ungrouped; a note added pinned to the node picked, written, its square dot dragged onto another node, its line cut to unpin it, pinned again from its panel, then read in FORMS and EDIT IN GRAPH back to it; the CWN example measured: every dot on its row, every wire drawn, nothing overlapping, a readable zoom; a wire going backwards kept out of its nodes; the map in all seven themes' colors. Each journey puts FORMS back after, as the others expect it |
| `tests/graph-shots.spec.ts` | Not a check: with `GRAPH_SHOTS=1` set, pictures of the graph view (CWN as it opens, fitted, with a node hovered, with a group of its saves, with a node's panel open, with a note added, with a condition added, with PROBLEMS opened, and in each theme; and a small system's house rule tried on the map) into `docs/mockups/shots/`, to look at by eye before a PR that changes how it looks |
| `tests/builder-systems.spec.ts` | MY SYSTEMS as a GM uses it: a system just made is closed with CLOSE (it could not be deleted while open, and there was no way to close it), then deleted |
| `tests/sheet-rolls.spec.ts` | A custom system's own roll at the table (6b2a): a published system running as the game with a roll rolled by a stats group; a player's sheet showing a die button by each stat in it, and a click rolled by the server from the stored sheet (read from what it broadcasts, the line the log shows); a stat with two rolls asking first, GRIT SAVE with ADVANTAGE picked in the chooser, two d20 the higher kept; PUSH adding 2 Stress (6b3a), the chooser showing 1 OF 4, the roll paying it and the sheet showing 3, then off at 3 OF 4 |
| `tests/player-journey.spec.ts` | A custom system running (set up through the API), played in two browsers at once: a player makes a character and sees the system's words and its formula worked out; the GM types in a catalogue, gives the player something from it with a note, and calls a rest from the GAME tab; the player sees the gift arrive and the rest change their sheet |
| `tests/builder-smoke.spec.ts` | The GM signs in, opens the System Builder, meets and skips the first-time tour (reset first, so it always shows), and goes back to the map |
