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
    // One argv element, not a substring of a shell command: the value arrives exactly as
    // written, whatever is in it.
    const at = args.indexOf('--project-directory');
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe(WORKING_DIR);
    expect(args).not.toContain('/project');
  });

  it('mounts the compose file read-only at its own host path, and gives compose that path', () => {
    // Compose writes the `-f` it was given into the containers' labels. Given the helper-only
    // /tmp/docker-compose.yml, the stack was left naming a file nobody else has, and the next
    // in-app update failed with "read /tmp/docker-compose.yml: is a directory" (seen on a real
    // install after its first successful in-app update).
    const args = buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, NO_PROJECT);
    const vArgs = args.filter((_, i) => args[i - 1] === '-v');
    expect(vArgs).toContain(`${CONFIG_FILE}:${CONFIG_FILE}:ro`);
    expect(args[args.indexOf('-f') + 1]).toBe(CONFIG_FILE);
    expect(args).not.toContain('/tmp/docker-compose.yml');
  });

  it('runs the helper on the image it is given, the one this server runs', () => {
    const args = buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, NO_PROJECT, 'over2take/citynet-backend:2.0.0-dev.2');
    expect(args[args.indexOf('docker') - 1]).toBe('over2take/citynet-backend:2.0.0-dev.2');
    expect(buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, NO_PROJECT)).toContain('over2take/citynet-backend:latest');
  });

  it('includes the docker socket mount', () => {
    const args = buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, NO_PROJECT);
    const vArgs = args.filter((_, i) => args[i - 1] === '-v');
    expect(vArgs).toContain('/var/run/docker.sock:/var/run/docker.sock');
  });

  it('forwards the project name as its own argument', () => {
    const args = buildUpdateHelperArgs(WORKING_DIR, CONFIG_FILE, WITH_PROJECT);
    const at = args.indexOf('-p');
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe('mapsystem');
  });

  it('never hands the command to a shell', () => {
    // The command was assembled into an `sh -c` string with the working directory
    // interpolated in double quotes, which reads safe and is not — double quotes stop
    // word-splitting, they do not stop `$(...)` or backticks. The path comes from a
    // compose label, so a project directory named with a command substitution would have
    // run it, in a container holding the Docker socket.
    const nasty = '/srv/$(touch /tmp/pwned)';
    const args = buildUpdateHelperArgs(nasty, CONFIG_FILE, WITH_PROJECT);

    expect(args).not.toContain('sh');
    expect(args).not.toContain('-c');
    // Present, and present whole — carried as data rather than parsed.
    expect(args).toContain(nasty);
    expect(args.filter((a) => a.includes('touch /tmp/pwned'))).toHaveLength(2); // the -v mount and the --project-directory
  });

  it('survives a working directory with a space in it', () => {
    const spaced = '/srv/my city';
    const args = buildUpdateHelperArgs(spaced, CONFIG_FILE, NO_PROJECT);
    expect(args[args.indexOf('--project-directory') + 1]).toBe(spaced);
  });
});
