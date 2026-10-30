---
name: mutation-check
description: Check that new tests really guard new code in CITY_NET by breaking the code on purpose and confirming the tests fail. Use after writing tests for a builder piece or a fix, before pushing, or when asked to mutation-check.
---

# Mutation check

A test suite that passes proves little until it has failed for the right reason. Break the new
code on purpose, one small change at a time, and confirm a test fails each time. The runner is
`scripts/mutation-check.js`.

## 1. Pick the breaks

Pick 5 to 30 for a piece, aimed at what the piece added or changed. Each one is a single exact
text swap:
- a condition flipped or loosened: `>=` to `>`, `a && b` to `a`, `kind === 'x'` to `true`;
- a constant changed: a limit, a default, a sample value;
- a branch or a line removed (replaced with `''`), a guard dropped;
- a returned field left out, a message's words changed;
- on the frontend: an `aria-*` attribute removed, a condition that shows a control set to `true`.

Leave out breaks that change nothing a person could notice. A surviving break like that only shows
the code could be simpler.

## 2. Write the plan

Write it to the scratchpad, not the repo:

```json
{
  "tests": {
    "server": { "cwd": "backend", "cmd": "npx vitest run --maxWorkers=2 --bail=1 __tests__/system_builder_x.test.js" },
    "front": { "cwd": "frontend", "cmd": "npx vitest run --maxWorkers=2 --bail=1 src/sheets/__tests__/x.test.ts" }
  },
  "files": [
    { "file": "backend/systemBuilder/x.js", "tests": "server", "mutants": [["if (a && b)", "if (a)"]] }
  ]
}
```

- Give each file the narrowest tests that cover it. `--bail=1` stops at the first failure, so a
  caught break doesn't wait out every other test.
- Each "from" must appear exactly once in its file. Write line breaks as `\n`; the runner handles
  CRLF.

## 3. Run it

```bash
node scripts/mutation-check.js <plan.json>
```

The runner checks that the tests pass before anything is broken, saves every file first, and puts
each one back after each break. It prints `N of M caught` and exits 1 if anything survived, was
missing, or didn't come back as it was.

**If a run is stopped or killed:** run `node scripts/mutation-check.js --restore`, then
`git diff` the files, before anything else, and before committing. Never chain a commit after a
mutation run except with `&&`.

## 4. Act on what survived

- **A missing test:** add or tighten one so it fails on that break, then run the plan again.
- **Code that isn't needed:** if no test could catch the break because the code makes no
  difference, remove the code.
- **A break that can't be caught by a test:** say why in the report, and don't leave it unexplained.

Report the result as **N of M caught**, and name any test you added because of a survivor.
