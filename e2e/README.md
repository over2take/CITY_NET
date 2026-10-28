# CITY_NET browser tests (e2e)

The real app in a real browser: the backend and the frontend started fresh, and Playwright driving
them the way a GM and players would. Everything else in the repo is tested piece by piece; these
journeys check the pieces work together on screen.

[COVERAGE.md](COVERAGE.md) maps every option a GM can set in the System Builder to the journey that
proves it at the table, and lists the gaps still to close. A piece that adds or changes an option
updates its row there.

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
- CI's runner is several times slower than a desktop, so never bet on how long something takes:
  wait for what you expect with `expect(...)` or `expect.poll`, not `waitForTimeout`.
- Each Playwright click waits for its target to be ready, so a few of them can take longer than
  half a second on CI. Where the server treats things done close together as one (rolls within
  400 ms are one throw), do them from inside the page with `page.evaluate`, a frame apart, as the
  dice tray's no-queue journey does.
- A state flag isn't the end of an animation. The rail's `data-expanded` turns false as it starts
  to narrow, and on CI the clicks sweep once measured the page under the rail still closing; so
  `clickRail` also waits for `getAnimations()` on the rail to be empty. Do the same for anything
  that slides or fades over the page before checking what's under it.
- When a journey fails only on CI, the run's **e2e-report** download (bottom of the run's Summary
  page) holds each failure's `trace.zip`; its screencast frames show the page at the failing step.
- Put shared steps (signing in, opening the builder) in `tests/helpers.ts`.

## Files

| File | What it is |
| --- | --- |
| `playwright.config.ts` | Starts both servers on their own ports with the throwaway database and the test GM; one headless browser |
| `cleanup.ts` | Before a run, deletes the throwaway databases earlier runs left |
| `tests/helpers.ts` | Signing in as the GM or a player, opening the GAME tab and the builder (past the tour), a rail button clicked with the pointer moved off after, a builder page from the rail; and through the API, a system made, published and running, and a player registered and approved |
| `tests/builder-journey.spec.ts` | The GM builds a system from + NEW (words, a part off, a stat and a formula worked out on the sample), a save made from a preset on ROLLS with a target, its players told only the verdict while the new system keeps every target from them, publishes it, changes it and publishes v2 through the version preview, and switches the game to it; then a player rolls the save from their sheet and is told SUCCESS or FAILURE, while the GM is told what it was against and that players weren't (Phase 6) |
| `tests/builder-clicks.spec.ts` | Every control on every builder page, the rail, each STATS & RULES tab (DICE with dice made, a symbol's drawing pad and icons open; ROLLS with a Blades and a Vampire roll, all five steps and TEST ROLL showing, its condition switches too: a condition given ALL ROLLS −1 on CONDITIONS first; and a roll's panel on GRAPH), NPCS' TIERS tab, and STATS & RULES in GRAPH included, takes a click where a person would click it (the map's overlay lets the pointer through to the map wherever nothing claims it, which unit tests can't see); INSTALL A FILE opens the file picker when clicked and takes a dropped file; a CWN SAVE among the ROLLS presets so step 3's PLAYERS SEE is swept, and HELP's WHO SEES THE TARGET reached from the ROLLS tab's HOW PLAYERS SEE IT and swept (6c4h); CHOICES with a list picking several, an option and an open feature with uses and a modifier, so every box on it is swept (7a2b1, 7a2b2) |
| `tests/builder-choices.spec.ts` | CHOICES (7a2b1, 7a2b2): a class list made, renamed, levelled and MORE THAN ONCE, its level name shown, two options (one requiring INT 13), SOLDIER given a feature at level 2 with +1 Intellect and uses a long rest refills, saved with no problems, and found as left after a reload |
| `fixtures/emberline.citysys` | A random system file for INSTALL A FILE, made by the test generator and exported the way the builder exports |
| `tests/builder-rolls.spec.ts` | STATS & RULES' ROLLS tab (6b1a): a roll made from a preset, named, rolled by a stats group, TEST ROLL on the server for a field with a change, then under HURT (6b3c, one less and named in the working) (with GRAPH_SHOTS=1, a picture of the tab into `docs/mockups/shots/`), and all of it kept after a reload; a roll on GRAPH (6b4a): its node with the wire from the stats list's own dot (with GRAPH_SHOTS=1, pictures of the node and its panel), its panel renaming it on the map, TEST ROLL there; + ADD → ROLL · BLADES ACTION, and the SKILLS list's own dot dragged onto it (6b4b); a roll's dice, reading, adding, bands and special results (exploding once, a natural) edited and TEST ROLL rolling it as edited |
| `tests/builder-dice.spec.ts` | STATS & RULES' DICE tab (6c2b2): dice made from GOOD / GREAT / BAD, a face given +2 and a HIT, HIT drawn on the pad with a real pointer stroke, four thrown by TEST on the server, one of the table's CUSTOM_DIE.EXE dice copied in (its SKULL a symbol), a roll of two GOOD dice reading what is left of HIT and tested on the server (6c3), all of it kept after a reload (with GRAPH_SHOTS=1, a picture of the tab) |
| `tests/builder-graph.spec.ts` | STATS & RULES as a map (5a3a): a system drawn, a node dragged (undone with Ctrl+Z and done again with Ctrl+Y) and a group folded, all kept after a reload with GRAPH remembered, then FORMS showing the same system; a node clicked and edited in its panel, the map gaining the wire and the value, and FORMS the same; a wire drawn from a dot onto a formula, undone and done again, one cut and one that opens the panel instead, and FORMS with the formula they left; a modifier's diamond on its wire, its number changed in the panel and followed by the diamond, the value and FORMS; a table added with A where the GM is looking, removed with Delete and brought back with Ctrl+Z; a condition added with A, its IF, THEN and ELSE written in the panel, a wire into it asking to compare, and the same in FORMS; PROBLEMS on the map: a broken formula outlined red, picked from the list and moved to, fixed in its panel and gone once saved; TRY ON THE MAP: a house rule's formula swapped in for the map's numbers and wires only, never saved; hovering a node lighting what it reads and what reads it, its wires cyan, the rest faded and back when the pointer leaves; a formula put in a new group of its own from its panel, the group named from its title bar, shown in FORMS with EDIT IN GRAPH back to it, a second formula joining it and the two lined up, and ungrouped; a note added pinned to the node picked, written, its square dot dragged onto another node, its line cut to unpin it, pinned again from its panel, then read in FORMS and EDIT IN GRAPH back to it; the CWN example measured: every dot on its row, every wire drawn, nothing overlapping, a readable zoom; a wire going backwards kept out of its nodes; the map in all seven themes' colors. Each journey puts FORMS back after, as the others expect it |
| `tests/graph-shots.spec.ts` | Not a check: with `GRAPH_SHOTS=1` set, pictures of the graph view (CWN as it opens, fitted, with a node hovered, with a group of its saves, with a node's panel open, with a note added, with a condition added, with PROBLEMS opened, and in each theme; and a small system's house rule tried on the map) into `docs/mockups/shots/`, to look at by eye before a PR that changes how it looks |
| `tests/builder-systems.spec.ts` | MY SYSTEMS as a GM uses it: a system just made is closed with CLOSE (it could not be deleted while open, and there was no way to close it), then deleted |
| `tests/builder-share.spec.ts` | A system with an uploaded image shared with it: EXPORT asks first (ticked to send it), saves a zip of the system and the image, and INSTALL A FILE takes the zip, counting its image, and installs a second copy with it |
| `tests/dice-tray.spec.ts` | DICE_TRAY.EXE's new dice (6c4b2b): a handful of d4 to d20 rolled from the dice menu, the throw naming every die and the face it landed on (what it shows, less one); a running system's own dice (a drawn SKULL, a bad die) rolled by a player, each landing on a face showing what the log wrote, the bad die in the danger color; no errors on the page (with GRAPH_SHOTS=1, the tray early in the throw, mid-throw and landed); and the title bar's ANIMATION toggle (6c4b3b): turned off, still off after a reload and a fresh sign-in (kept on the account), turned back on; and no queue (6c4c): two quick rolls from one person sharing the server's group and landing as one throw, then a roll a moment later cutting in with the two before already in the record and its own not yet; and the tray in the theme picked: in Oceanic, its board's lit dots and its record are cyan, not Classic's green (it once sat outside the app's theme); and the board (6c4e): rolling while the dice are thrown, then the total in big digits once they are down; someone else's roll flashing a player's shut tray buttons, one rail click opening the tray on its history, and the bell (right of ANIMATION) turning that off (6c4g) |
| `tests/sheet-rolls.spec.ts` | A custom system's own roll at the table (6b2a): a published system running as the game with a roll rolled by a stats group; a player's sheet showing a die button by each stat in it, and a click rolled by the server from the stored sheet (read from what it broadcasts, the line the log shows); a stat with two rolls asking first, GRIT SAVE with ADVANTAGE picked in the chooser, two d20 the higher kept; PUSH adding 2 Stress (6b3a), the chooser showing 1 OF 4, the roll paying it and the sheet showing 3, then off at 3 OF 4; and a running system's own dice in the dice menu (6c4a): listed under THIS GAME'S DICE, two Good and a Bad rolled by the server, each face as the log writes it |
| `tests/sheet-choices.spec.ts` | A custom system's CHOICES block at the table (7a3b1): a player picks a class on their sheet (one they don't meet is off, saying what it needs), its bonus reaches Defense, a level up unlocks the next feature, a use ticked off comes back with a short rest the GM calls; and the GM on their own sheet adds an option they don't meet (ADD ANYWAY), sees Guard Stance's bonus named on Defense, and takes a pick away, asked first (7a3b2) |
| `tests/player-journey.spec.ts` | A custom system running (set up through the API), played in two browsers at once: a player makes a character and sees the system's words and its formula worked out; the GM types in a catalogue, gives the player something from it with a note, and calls a rest from the GAME tab; the player sees the gift arrive and the rest change their sheet |
| `tests/builder-smoke.spec.ts` | The GM signs in, opens the System Builder, meets and skips the first-time tour (reset first, so it always shows), and goes back to the map |
