import { describe, it, expect, afterEach, vi } from 'vitest';
import { askMainWindow, answerMainWindowAsks, askOfLink, ASK_WAIT_MS, MAIN_WINDOW_CHANNEL } from '../mainWindow';

// The standalone sheet tab asking the main app to open BANK, HEALTH or VEHICLES (8s1d).

const stops: (() => void)[] = [];
afterEach(() => { while (stops.length) stops.pop()!(); });
const answering = (user: string) => {
  const opened: string[] = [];
  stops.push(answerMainWindowAsks(user, (what) => opened.push(what)));
  return opened;
};

describe('the tab asks, the main app opens', () => {
  it('the main app signed in as the same player opens what is asked and says so', async () => {
    const opened = answering('kes');
    expect(await askMainWindow('bank', 'kes')).toBe(true);
    expect(await askMainWindow('health', 'kes')).toBe(true);
    expect(await askMainWindow('vehicles', 'kes')).toBe(true);
    expect(opened).toEqual(['bank', 'health', 'vehicles']);
  });

  it('nobody answering, or the main app signed in as another, is said as not opened', async () => {
    expect(await askMainWindow('bank', 'kes', 50)).toBe(false);
    const opened = answering('vex');
    expect(await askMainWindow('bank', 'kes', 50)).toBe(false);
    expect(opened).toEqual([]);
  });

  it('what is not one of the three, or has no id, is passed over, and nothing is said back', async () => {
    const opened = answering('kes');
    const tab = new BroadcastChannel(MAIN_WINDOW_CHANNEL);
    const heard: unknown[] = [];
    tab.onmessage = (e) => heard.push(e.data);
    tab.postMessage({ kind: 'open', what: 'shop', user: 'kes', id: 'a' });
    tab.postMessage({ kind: 'open', what: 'bank', user: 'kes' });
    tab.postMessage({ kind: 'close', what: 'bank', user: 'kes', id: 'b' });
    tab.postMessage(null);
    await new Promise((r) => setTimeout(r, 50));
    tab.close();
    expect(opened).toEqual([]);
    expect(heard).toEqual([]);
  });

  it('an answer to another ask is not this one\'s, nor is anything said back but OPENED', async () => {
    const main = new BroadcastChannel(MAIN_WINDOW_CHANNEL);
    main.onmessage = (e) => {
      main.postMessage({ kind: 'opened', id: 'someone-else' });
      main.postMessage({ kind: 'refused', id: e.data.id });
    };
    stops.push(() => main.close());
    expect(await askMainWindow('bank', 'kes', 50)).toBe(false);
  });

  it('a browser without BroadcastChannel: the ask is said as not opened, and the main app listens for nothing', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    try {
      expect(await askMainWindow('bank', 'kes', 50)).toBe(false);
      expect(() => answerMainWindowAsks('kes', () => {})()).not.toThrow();
    } finally { vi.unstubAllGlobals(); }
  });

  it('once it stops listening, it opens nothing more', async () => {
    const opened: string[] = [];
    answerMainWindowAsks('kes', (what) => opened.push(what))();
    expect(await askMainWindow('bank', 'kes', 50)).toBe(false);
    expect(opened).toEqual([]);
  });

  it('the balance opens the bank; every other linked field the health window; waits long enough to be answered', () => {
    expect(askOfLink('bank_balance')).toBe('bank');
    for (const s of ['token_hp', 'token_hp_max', 'token_ac', 'token_ac_ranged']) expect(askOfLink(s)).toBe('health');
    expect(ASK_WAIT_MS).toBeGreaterThanOrEqual(1000);
  });
});
