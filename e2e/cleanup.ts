import fs from 'fs';
import os from 'os';
import path from 'path';

// Before a run: the throwaway databases earlier runs left in the temp folder. A run can't delete its
// own at the end (the backend still holds it open as the run finishes, and Windows won't delete an
// open file), so each run clears the ones before it: at most one is ever left.
export default function cleanup() {
  const dir = os.tmpdir();
  // Never this run's own (playwright.config.ts names it), which the backend may have open already.
  const mine = process.env.E2E_DATABASE ? path.basename(process.env.E2E_DATABASE) : null;
  for (const name of fs.readdirSync(dir)) {
    if (!/^citynet-e2e-\d+\.db(-wal|-shm|-journal)?$/.test(name)) continue;
    if (mine && name.startsWith(mine)) continue;
    try { fs.unlinkSync(path.join(dir, name)); } catch { /* still open elsewhere: the next run gets it */ }
  }
}
