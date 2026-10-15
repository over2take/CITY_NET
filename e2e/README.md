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
  account or password is used.
- Runs in **Secure Mode**, as a real table does: everyone signs in.
- Drives **one headless browser**, one test at a time. Both servers are stopped when it finishes.

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
  makes what it needs (a system, a character) rather than expecting it to be there.
- The tests share one database and run in order, one at a time, files alphabetically. A journey that needs a
  fresh state (the tour unseen) sets it up through the API first, rather than counting on running first.
- Put shared steps (signing in, opening the builder) in `tests/helpers.ts`.

## Files

| File | What it is |
| --- | --- |
| `playwright.config.ts` | Starts both servers on their own ports with the throwaway database and the test GM; one headless browser |
| `cleanup.ts` | Before a run, deletes the throwaway databases earlier runs left |
| `tests/helpers.ts` | Signing in as the GM, opening the GAME tab and the builder (past the tour), and a builder page from the rail |
| `tests/builder-journey.spec.ts` | The GM builds a system from + NEW (words, a part off, a stat and a formula worked out on the sample), publishes it, changes it and publishes v2 through the version preview, and switches the game to it |
| `tests/builder-smoke.spec.ts` | The GM signs in, opens the System Builder, meets and skips the first-time tour (reset first, so it always shows), and goes back to the map |
