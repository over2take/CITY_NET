import { describe, it, expect, vi, afterEach } from 'vitest';
import config from '../../vite.config';

// The dev and preview servers' logger (8n4, vite.config.ts): the socket proxy's EPIPE and ECONNRESET, a browser closing
// mid-message, are dropped; every other error is still said.

const logger = (config as { customLogger?: { error: (msg: string) => void } }).customLogger!;
const said = () => vi.spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => vi.restoreAllMocks());

describe('the servers\' logger', () => {
  it('drops a closed browser\'s EPIPE and ECONNRESET on the socket\'s proxy', () => {
    const spy = said();
    logger.error('2:55:47 AM [vite] ws proxy error:\nError: write EPIPE\n    at afterWriteDispatched (node:internal/stream_base_commons:138:10)');
    logger.error('[vite] ws proxy socket error:\nError: read ECONNRESET\n    at TCP.onStreamRead');
    expect(spy).not.toHaveBeenCalled();
  });

  it('says any other proxy error, and anything else', () => {
    const spy = said();
    logger.error('[vite] ws proxy error:\nError: connect ECONNREFUSED 127.0.0.1:5055');
    logger.error('[vite] http proxy error: /api/version\nError: write EPIPE');
    logger.error('Build failed');
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
