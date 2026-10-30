# CITY_NET: notes for AI coding agents

For any AI coding tool working on this repo (Claude Code reads it through `CLAUDE.md`), and for the
people using one.

A shared city map for tabletop games, with tokens, character sheets, shops, a bank and dice, run
by a GM for their players. Since Phase 1 a **System Builder** lets a GM make any game's rules:
words, parts, stats and formulas, rolls, choices, rests, conditions.

The builder's plan and its mockups live in `docs/`, which is gitignored and exists only on the
main developer's machine. If you don't have it, don't go looking for it: ask the owner, and work
from the code, `CHANGELOG.md` and the README.

- `backend/`: Node + Express + Socket.IO, SQLite. The builder's rules are `backend/systemBuilder/`.
- `frontend/`: React + TypeScript + Vite. Pure logic sits in `frontend/src/sheets/`, and the
  components only draw it.
- `e2e/`: Playwright browser journeys against the real backend and frontend (`e2e/README.md`).

## Commands

| What | Where | Command |
|---|---|---|
| Backend tests | `backend/` | `npx vitest run [files]`. Vitest, never `npx jest`. |
| Frontend tests | `frontend/` | `npx vitest run [files] --maxWorkers=2` |
| Frontend typecheck | `frontend/` | `npx tsc -b`. Plain `tsc --noEmit` checks nothing here. |
| Frontend lint | `frontend/` | `npx eslint <files>` |
| Browser journeys | `e2e/` | `npx playwright test tests/<file> --workers=1 --retries=0` |
| Mutation check | root | `node scripts/mutation-check.js <plan.json>` (see `.claude/skills/mutation-check/SKILL.md`) |
| Changelog entry | root | `node scripts/changelog-add.js "### Added" <entry.md>` |

Check a test run by its exit code, not its summary line: Vitest can print every test green and
still exit 1 on an error outside a test. The person you're working for is usually on the same
machine, so go easy on it: `--maxWorkers=2`, one headless browser, a small viewport, and stop
servers when done. Their dev server and live database (`backend/city.db`) are theirs: never use them
for tests. The journeys start their own servers on ports 5055 and 5174.

## House rules

- **Git:** never push to `main` or `dev`. Builder work goes in small pieces, one branch each, PR'd
  into `feature/system-builder`. Wait for a piece to be merged before starting the next one,
  with no stacked branches. No AI co-author trailers or "generated with" footers.
- **Every piece** follows `.claude/skills/builder-piece/SKILL.md`: tests, a mutation check, the
  upload paths, the docs, then a compare link and what to try.
- **US spelling** everywhere (color, armor), as the code's own names are.
- **Themes:** all 7 must work. Only theme variables, never a hard-coded color: `--green`, `--cyan`,
  `--black`, `--dark-green`, `--danger`, `--warning`, `--grid-section`, `--grid-cell`,
  `--panel-bg`. Portal floating UI into `themeRoot()` (`frontend/src/utils/themeRoot.ts`), never
  `document.body`, or it falls outside the theme.
- **Windows:** use `DraggableWindow`, named like a program (`SHOP.EXE · VIC'S ARMS`), and
  `TerminalWindow` for a window with several parts. Prefer folders in an existing window over new
  windows. Keep rules in tested pure modules.
- **Line endings:** the source is CRLF. A script that edits files reads them as LF and writes CRLF
  back. On Windows, don't pass quoted code to `node -e` from PowerShell: write a script file.
- **Lint:** react-refresh allows no hooks or other exports beside an exported component, so hooks go
  in `frontend/src/hooks/`.
- **New libraries:** ask first, and add each to the README's Tech stack table in the same PR.
- **Frontend tests and backend code:** a frontend test may load a backend module only if that
  module needs no third-party package (CI's frontend job has none).
  `frontend/src/__tests__/crossBoundaryImports.test.ts` checks it.
- **Changing a message:** grep the tests for the old words before pushing. Tests pin messages word
  for word.

## Browser journeys

- **On CI they run in four parts at once**, split test by test, each part on a fresh database. So
  every test stands alone: never lean on what an earlier test made.
- CI is several times slower than a desktop, so wait for what you expect (`expect`, `expect.poll`),
  never for a fixed time. A builder draft saves itself 5 s after the last edit: wait for
  `save-status` to say `· SAVED` before reading it through the API.
- Look up a status within its panel, never across the whole page: each formula box has a
  `role="status"` words line.
- A new builder page, tab or panel joins `tests/builder-clicks.spec.ts` in the same PR. A new thing
  the GM makes gets its own short journey. Each option a GM can set is proven at the table once,
  tracked in `e2e/COVERAGE.md`.
