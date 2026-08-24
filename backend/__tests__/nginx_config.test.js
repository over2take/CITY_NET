/**
 * The proxy config, checked against what the app expects of it.
 *
 * Every request reaches the backend through nginx in a Docker install, and no other test
 * here goes anywhere near it — they all mount routers directly, so the proxy is untested
 * infrastructure by construction. That gap has already cost twice in one release: the
 * body limit sat at 25M while battle maps moved to 250MB, and `X-Forwarded-For` was
 * missing so every request appeared to come from the proxy's own address.
 *
 * Both were invisible to a suite of a thousand passing tests, and both are one line of
 * config. These are the assumptions the application code makes about that file. They are
 * static checks — reading the config, not running it — so they cost nothing and catch the
 * class of mistake that has actually happened. The CI job `Nginx Proxy Behaviour` runs
 * the real thing for the parts a grep cannot judge.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { LIMITS } = require('../middleware/uploadConstraints.js');

const conf = fs.readFileSync(new URL('../../nginx.conf', import.meta.url), 'utf8');

/** The body of a `location <prefix>` block. */
const locationBlock = (prefix) => {
  const at = conf.indexOf(`location ${prefix}`);
  if (at === -1) return null;
  const open = conf.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < conf.length; i++) {
    if (conf[i] === '{') depth++;
    else if (conf[i] === '}' && --depth === 0) return conf.slice(open + 1, i);
  }
  return null;
};

describe('nginx.conf — what the app assumes of the proxy', () => {
  it('allows a body at least as large as the biggest upload the app accepts', () => {
    // It sat at 25M while battle maps moved to 250MB. A large animated map would have
    // been refused by the proxy before the app saw it, with a 413 of nginx's own that
    // names neither the file nor the reason.
    const match = /client_max_body_size\s+(\d+)([KMG])?;/i.exec(conf);
    expect(match, 'client_max_body_size not found').toBeTruthy();

    const scale = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 };
    const allowed = Number(match[1]) * (scale[(match[2] || '').toUpperCase()] || 1);
    expect(allowed).toBeGreaterThanOrEqual(Math.max(...Object.values(LIMITS)));
  });

  it('forwards who sent the request', () => {
    // Without this every request reaches the backend from the proxy's address, and the
    // per-caller rate limit becomes one bucket shared by the whole table. `trust proxy`
    // in server.js reads this header specifically — X-Real-IP alone is not enough.
    const api = locationBlock('/api/');
    expect(api, 'no location /api/ block').toBeTruthy();
    expect(api).toMatch(/proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/);
  });

  it('lets the socket upgrade', () => {
    // Without both headers the WebSocket handshake falls back to polling, which mostly
    // works and is slower in a way nobody traces back to here.
    const socket = locationBlock('/socket.io/');
    expect(socket, 'no location /socket.io/ block').toBeTruthy();
    expect(socket).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade;/);
    expect(socket).toMatch(/proxy_set_header\s+Connection\s+"upgrade";/i);
    expect(socket).toMatch(/proxy_http_version\s+1\.1;/);
  });

  it('proxies every path the backend serves', () => {
    // A route mounted in server.js with no location block here is unreachable in Docker
    // and perfectly reachable in every test, which is the worst combination.
    for (const prefix of ['/api/', '/socket.io/', '/uploads/']) {
      expect(locationBlock(prefix), `no location ${prefix}`).toBeTruthy();
    }
  });

  it('sends them all to the same backend the compose file names', () => {
    const compose = fs.readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
    const targets = [...conf.matchAll(/proxy_pass\s+http:\/\/([a-z0-9_-]+):(\d+);/gi)];
    expect(targets.length).toBeGreaterThan(0);

    for (const [, host, port] of targets) {
      // The service has to exist under that name, or the proxy resolves nothing.
      expect(compose, `no service "${host}" in docker-compose.yml`).toMatch(new RegExp(`^\\s{2}${host}:`, 'm'));
      expect(port).toBe('5000');
    }
  });
});
