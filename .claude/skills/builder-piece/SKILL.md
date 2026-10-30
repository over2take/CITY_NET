---
name: builder-piece
description: The steps for one System Builder piece in CITY_NET, from branch to the report with a compare link. Use when starting, finishing or pushing any piece of builder work, or any small PR into feature/system-builder.
---

# One builder piece

Builder work goes in small pieces, one branch and one PR each, into `feature/system-builder`.
The person who owns the repo merges; never push to `main` or `dev`.

## 1. Start

- The previous piece must be merged first. Then branch from the updated origin:
  `git fetch origin && git checkout -b sb/<piece> origin/feature/system-builder`.
- A new page, window or mechanic gets a mockup first (`docs/mockups/`, listed in its README), and is
  built only once it's approved.

## 2. Build

- Rules go in pure modules (backend `systemBuilder/`, frontend `src/sheets/`), and components only
  draw them.
- Use theme variables only, and portal floating UI into `themeRoot()` (see CLAUDE.md).
- A new or changed hint goes in `frontend/src/sheets/builderHelp.ts`.

## 3. Test

- Add tests for what was built: server tests for rules and routes, component tests for pages.
- Run the tests of every file that imports a changed module (grep for its name), plus
  `npx tsc -b` and `npx eslint <files>` in `frontend/`. Check exit codes.
- If a message changed, grep the tests for its old words.
- Run the **mutation check** (the `mutation-check` skill) on the new logic. Every break should be
  caught; for each one that survives, add or tighten a test, or remove the code it shows isn't
  needed.
- **Browser journeys:** a new page, tab or panel joins `e2e/tests/builder-clicks.spec.ts`. A new
  thing the GM makes gets its own short journey. Run the new journey and its neighbours locally,
  never the whole suite (CI does that).

## 4. Upload paths

Check that every way in and out of a system carries what the piece adds, and add a round-trip test
(download, then import back unchanged):
- the CHOICES importer (`backend/systemBuilder/choicesImport.js`) and its DOWNLOAD EXAMPLE and
  DOWNLOAD THIS LIST (`frontend/src/sheets/choicesImport.ts`);
- the sheet importer and its downloadable PDF form;
- the system file and its .zip, exported and installed (`backend/systemBuilder/citysys.js`).

Say in the report which paths were checked, even when none needed a change.

## 5. Docs, in the same PR

- `CHANGELOG.md`, under `[Unreleased]`: `### Added`, `### Changed`, `### Fixed`, or
  `### Under the hood` for work players can't see. Write the entry to a file, then
  `node scripts/changelog-add.js "### Added" entry.md`.
- `README.md` Project Structure: a line for every new file, and an updated line for a file that
  changed what it does.
- `e2e/README.md`: a row for every new journey. `e2e/COVERAGE.md`: a row for every option added or
  changed.
- At the end of a phase, also update the builder's tour, HELP topics and hints, and extend
  `e2e/tests/builder-journey.spec.ts`.

## 6. Push and report

- Commit only the files of the piece (`git add <files>`, never `git add -A`). No AI attribution.
- Push the branch, then report to the user:
  - the compare link: `https://github.com/over2take/CITY_NET/compare/feature/system-builder...sb/<piece>`;
  - what changed, in plain words;
  - what was checked, with real numbers;
  - which upload paths were checked;
  - then **TO TRY** (steps, and whether the backend needs a restart) or **NOTHING TO TRY**.
- Wait for "merged" before the next piece.
