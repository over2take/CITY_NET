// Whether the Node.js this server runs on has the October 2026 security fixes (1.14.10): ten
// flaws, one an out-of-bounds write in the Brotli decoder (CVE-2026-111497). The Docker images run
// a fixed Node; a manual install runs whatever its machine has, so the server says so at start.

/** The first release with the fixes, by release line. Node 20 and older are past their end and never got them. */
const FIXED = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };
/** The first line released after the fixes: everything from it on has them. */
const FIXED_FROM_LINE = 27;

/** A version string as numbers: 'v24.22.1' → [24, 22, 1]; null for anything else. */
const parts = (version) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** True when `version` (as process.version gives it) has the October 2026 fixes. */
const hasSecurityFixes = (version) => {
  const v = parts(version);
  if (!v) return false;
  if (v[0] >= FIXED_FROM_LINE) return true;
  const first = FIXED[v[0]];
  if (!first) return false;
  for (let i = 0; i < 3; i += 1) if (v[i] !== first[i]) return v[i] > first[i];
  return true;
};

/** What to tell the GM at start on a Node without the fixes, or null on one with them. */
const securityWarning = (version) => (hasSecurityFixes(version) ? null
  : `Node.js ${version} is missing the October 2026 security fixes. Update Node to 24.22.1 or newer (or 22.23.4+), or run CITY_NET with Docker.`);

module.exports = { hasSecurityFixes, securityWarning, FIXED };
