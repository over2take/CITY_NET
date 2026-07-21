import { describe, it, expect } from 'vitest';
import { buildUpdateHelperArgs } from '../routes/admin.js';

const WORKING_DIR = '/opt/mapsystem';
const CONFIG_FILE = '/opt/mapsystem/docker-compose.yml';
const NO_PROJECT = [];
const WITH_PROJECT = ['-p', 'mapsystem'];

describe('buildUpdateHelperArgs — volume mounts', () => {
  it('mounts the host working dir at its own path, not an alias', () => {
    const args = buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, NO_PROJECT);
    const vArgs = args.filter((_, i) => args[i - 1] === '-v');
    // The working-dir volume must be identity-mapped: hostPath:hostPath
    expect(vArgs).toContain(`${WORKING_DIR}:${WORKING_DIR}`);
  });

  it('does NOT mount the working dir at /project or any other alias', () => {
    const args = buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, NO_PROJECT);
    // The exact working-dir volume entry must be identity-mapped; an alias
    // like /opt/mapsystem:/project would pass to the daemon as /project,
    // causing Docker to create a new empty directory and wipe existing data.
    expect(args).not.toContain(`${WORKING_DIR}:/project`);
    // More generally: no entry should mount the working dir at a different target
    const vArgs = args.filter((_, i) => args[i - 1] === '-v');
    const wrongMount = vArgs.find(v => v === `${WORKING_DIR}:${WORKING_DIR}`) === undefined
      && vArgs.some(v => v.startsWith(`${WORKING_DIR}:`) && !v.startsWith(`${WORKING_DIR}:${WORKING_DIR}`));
    expect(wrongMount).toBe(false);
  });

  it('passes --project-directory pointing to the host working dir', () => {
    const args = buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, NO_PROJECT);
    const shellCmd = args[args.length - 1];
    expect(shellCmd).toContain(`--project-directory "${WORKING_DIR}"`);
    expect(shellCmd).not.toContain('--project-directory "/project"');
    expect(shellCmd).not.toContain('--project-directory /project');
  });

  it('mounts the compose file read-only at /tmp/docker-compose.yml', () => {
    const args = buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, NO_PROJECT);
    const vArgs = args.filter((_, i) => args[i - 1] === '-v');
    expect(vArgs).toContain(`${CONFIG_FILE}:/tmp/docker-compose.yml:ro`);
  });

  it('includes the docker socket mount', () => {
    const args = buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, NO_PROJECT);
    const vArgs = args.filter((_, i) => args[i - 1] === '-v');
    expect(vArgs).toContain('/var/run/docker.sock:/var/run/docker.sock');
  });

  it('forwards project name args into the shell command', () => {
    const args = buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, WITH_PROJECT);
    const shellCmd = args[args.length - 1];
    expect(shellCmd).toContain('-p mapsystem');
  });
});
