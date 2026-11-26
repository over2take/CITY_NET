import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, within, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, titleControls }: { children: React.ReactNode; titleControls?: React.ReactNode }) => <div>{titleControls}{children}</div>,
  NotifyBell: () => null,
}));
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useThree: () => ({ scene: { children: [], add: vi.fn(), remove: vi.fn() }, camera: { lookAt: vi.fn(), position: { set: vi.fn() } } }),
  useFrame: () => {},
}));
vi.mock('../../assets/lets-icons--paper-fill.svg', () => ({ default: 'paper-fill.svg' }));
vi.mock('../../assets/lets-icons--paper-light.svg', () => ({ default: 'paper-light.svg' }));

import { DiceTrayWindow } from '../DiceTray';
import type { RollSend, SendTarget } from '../../sheets/sendTo';

/**
 * SEND TO in the GM's tray (8b7b; approved mockup docs/mockups/send-to.html, sections 1 and 2): under a line the server
 * says may be sent, the button and where it went; the picker with the GM's map's tokens, a fight's first, each FULL or HALF
 * with what it would take; SEND sends the server the tokens ticked. A line with nothing kept (every player's) has none.
 */

const FIRE: RollSend = { rollId: 7, what: 'Fireball', from: 'Mira', total: 28, types: ['FIRE'], sent: [] };
const TARGETS: SendTarget[] = [
  { id: 1, name: 'GOBLIN A', inFight: true },
  { id: 2, name: 'FIRE IMP', inFight: true },
  { id: 3, name: 'POWDER BARREL', inFight: false },
];
/** What the server says each would take: FIRE IMP immune, the barrel sent to already. */
const WOULD = (id: number, half: boolean) => ({
  1: { taken: half ? 14 : 28, words: half ? 'SAVED: HALF · WOULD TAKE 14 OF 28' : 'WOULD TAKE 28' },
  2: { taken: 0, words: `${half ? 'SAVED: HALF · ' : ''}IMMUNE FIRE: ${half ? 14 : 28} → 0 · WOULD TAKE 0 OF 28` },
  3: { taken: 28, words: 'WOULD TAKE 28' },
}[id]);

let sendAnswer: unknown;
const tray = (lines: unknown[], targets: SendTarget[] = TARGETS) => {
  const emit = vi.fn((event: string, payload: { rollId: number; targets: { locationId: number; half: boolean }[] }, ack?: (a: unknown) => void) => {
    if (event === 'sendRollPreview' && ack) {
      ack({ ok: true, targets: payload.targets.map((t) => ({ ...t, name: '', ...WOULD(t.locationId, t.half), sent: t.locationId === 3 })) });
    }
    if (event === 'sendRoll' && ack) ack(sendAnswer);
  });
  const socketRef = { current: { emit, on: vi.fn(), off: vi.fn() } };
  render(<DiceTrayWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} socketRef={socketRef} openHistory sendTargets={targets} />);
  const handler = (name: string) => socketRef.current.on.mock.calls.find((c: unknown[]) => c[0] === name)![1] as (d: unknown) => void;
  act(() => handler('diceRollHistory')(lines));
  return { emit, handler };
};
const line = (historyString: string, send?: RollSend) => ({ total: 28, results: {}, color: '#00ff00', historyString, ...(send ? { send } : {}) });
const MIRA = 'Mira rolled Fireball DAMAGE 8d6 FIRE DMG [(4, 3, 6, 2, 5, 1, 4, 3)] = 28 FIRE DMG';
const picker = () => screen.getByRole('group', { name: 'SEND FIREBALL (28 FIRE) TO' });

beforeEach(() => { sendAnswer = { ok: true, sent: ['GOBLIN A'] }; });
afterEach(() => cleanup());

describe('SEND TO under a line', () => {
  it('only under a line kept to send; opened, the GM\'s map\'s tokens, the fight\'s first, and what each would take FULL and HALF', () => {
    const t = tray([line('Kes rolled 1d20 [(15) + 6 = 21]'), line(MIRA, FIRE)]);
    expect(screen.getAllByRole('button', { name: /^Send .* to$/ })).toHaveLength(1);
    const open = screen.getByRole('button', { name: 'Send Fireball to' });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(t.emit.mock.calls.some((c) => c[0] === 'sendRollPreview')).toBe(false);
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.textContent).toBe('SEND TO ▴');
    const asked = t.emit.mock.calls.filter((c) => c[0] === 'sendRollPreview').map((c) => c[1]);
    expect(asked).toEqual([
      { rollId: 7, targets: [1, 2, 3].map((locationId) => ({ locationId, half: false })) },
      { rollId: 7, targets: [1, 2, 3].map((locationId) => ({ locationId, half: true })) },
    ]);
    const p = picker();
    expect(within(p).getByText('IN THE FIGHT')).toBeTruthy();
    expect(within(p).getByText('ALSO ON THIS MAP')).toBeTruthy();
    expect(within(p).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['GOBLIN A', 'FIRE IMP', 'POWDER BARREL']);
    // Sent there already: said, and not ticked again.
    expect((within(p).getByRole('checkbox', { name: 'POWDER BARREL' }) as HTMLInputElement).disabled).toBe(true);
    expect(within(p).getAllByTestId('send-would').map((w) => w.textContent)).toEqual(['SENT']);
    expect(within(p).getByText('Tick each one in the blast.')).toBeTruthy();
    expect((within(p).getByRole('button', { name: 'SEND' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ticked FULL, then HALF: what it would take each way; SEND sends the server each ticked, in the list\'s order', async () => {
    const t = tray([line(MIRA, FIRE)]);
    fireEvent.click(screen.getByRole('button', { name: 'Send Fireball to' }));
    const p = picker();
    const goblinHalf = within(within(p).getByRole('group', { name: 'GOBLIN A full or half' })).getByRole('button', { name: 'HALF' }) as HTMLButtonElement;
    expect(goblinHalf.disabled).toBe(true);
    fireEvent.click(within(p).getByRole('checkbox', { name: 'FIRE IMP' }));
    fireEvent.click(within(p).getByRole('checkbox', { name: 'GOBLIN A' }));
    expect(within(p).getByText('2 ticked')).toBeTruthy();
    expect(within(p).getAllByTestId('send-would').map((w) => w.textContent)).toEqual(['WOULD TAKE 28', 'IMMUNE FIRE: 28 → 0 · WOULD TAKE 0 OF 28', 'SENT']);
    expect(within(within(p).getByRole('group', { name: 'GOBLIN A full or half' })).getByRole('button', { name: 'FULL' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(goblinHalf);
    expect(goblinHalf.getAttribute('aria-pressed')).toBe('true');
    expect(within(p).getAllByTestId('send-would')[0].textContent).toBe('SAVED: HALF · WOULD TAKE 14 OF 28');
    fireEvent.click(within(p).getByRole('button', { name: 'SEND' }));
    expect(t.emit).toHaveBeenCalledWith('sendRoll', { rollId: 7, targets: [{ locationId: 1, half: true }, { locationId: 2, half: false }] }, expect.any(Function));
    // Sent: the picker shuts.
    await waitFor(() => expect(screen.queryByRole('group', { name: 'SEND FIREBALL (28 FIRE) TO' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Send Fireball to' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('a token unticked is left out; the server\'s no said, the picker kept; CANCEL shuts it and forgets the ticks', async () => {
    sendAnswer = { ok: false, error: 'That roll was made in another game' };
    const t = tray([line(MIRA, FIRE)]);
    fireEvent.click(screen.getByRole('button', { name: 'Send Fireball to' }));
    fireEvent.click(within(picker()).getByRole('checkbox', { name: 'GOBLIN A' }));
    fireEvent.click(within(picker()).getByRole('checkbox', { name: 'FIRE IMP' }));
    fireEvent.click(within(picker()).getByRole('checkbox', { name: 'GOBLIN A' }));
    fireEvent.click(within(picker()).getByRole('button', { name: 'SEND' }));
    expect(t.emit).toHaveBeenCalledWith('sendRoll', { rollId: 7, targets: [{ locationId: 2, half: false }] }, expect.any(Function));
    expect((await within(picker()).findByRole('alert')).textContent).toBe('That roll was made in another game');
    fireEvent.click(within(picker()).getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('group', { name: 'SEND FIREBALL (28 FIRE) TO' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send Fireball to' }));
    expect(within(picker()).queryByRole('alert')).toBeNull();
    expect(within(picker()).getAllByRole('checkbox').some((c) => (c as HTMLInputElement).checked)).toBe(false);
  });

  it('where it went under the line, told again as the server says (rollSent), on its own line alone', () => {
    const BOLT: RollSend = { rollId: 8, what: 'ARCANE BOLT', from: 'Kes', total: 12, types: [], sent: [] };
    const t = tray([line(MIRA, { ...FIRE, sent: ['FIRE IMP'] }), line('Kes rolled ARCANE BOLT [12]', BOLT)]);
    expect(screen.getAllByTestId('sent-to').map((s) => s.textContent)).toEqual(['SENT → FIRE IMP']);
    act(() => t.handler('rollSent')({ ...FIRE, sent: ['FIRE IMP', 'GOBLIN A'] }));
    expect(screen.getAllByTestId('sent-to').map((s) => s.textContent)).toEqual(['SENT → FIRE IMP, GOBLIN A']);
    // A plain roll's head says it has no type; one picker open at a time.
    fireEvent.click(screen.getByRole('button', { name: 'Send ARCANE BOLT to' }));
    expect(screen.getByRole('group', { name: 'SEND ARCANE BOLT (12, NO TYPE) TO' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send Fireball to' }));
    expect(screen.queryByRole('group', { name: 'SEND ARCANE BOLT (12, NO TYPE) TO' })).toBeNull();
    expect(picker()).toBeTruthy();
    expect(t.emit.mock.calls.some((c) => c[0] === 'sendRollPreview' && c[1].rollId === 8)).toBe(true);
    // Open while it goes somewhere new: asked again, for the new SENT.
    const asked = () => t.emit.mock.calls.filter((c) => c[0] === 'sendRollPreview' && c[1].rollId === 7).length;
    const before = asked();
    act(() => t.handler('rollSent')({ ...FIRE, sent: ['FIRE IMP', 'GOBLIN A', 'POWDER BARREL'] }));
    expect(asked()).toBe(before + 2);
  });

  it('one list where nobody is in a fight; nothing on the map, said so; a heard roll kept to send has it too', () => {
    const t = tray([], TARGETS.map((x) => ({ ...x, inFight: false })));
    act(() => t.handler('diceRollBroadcast')({ ...line(MIRA, FIRE), quiet: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Fireball to' }));
    expect(within(picker()).queryByText('IN THE FIGHT')).toBeNull();
    expect(within(picker()).getAllByRole('checkbox')).toHaveLength(3);
    cleanup();
    // Everyone in it: one list too.
    tray([line(MIRA, FIRE)], TARGETS.map((x) => ({ ...x, inFight: true })));
    fireEvent.click(screen.getByRole('button', { name: 'Send Fireball to' }));
    expect(within(picker()).queryByText('IN THE FIGHT')).toBeNull();
    expect(within(picker()).getAllByRole('checkbox')).toHaveLength(3);
    cleanup();
    const none = tray([line(MIRA, FIRE)], []);
    fireEvent.click(screen.getByRole('button', { name: 'Send Fireball to' }));
    expect(within(picker()).getByText('No tokens on this map.')).toBeTruthy();
    expect(none.emit.mock.calls.some((c) => c[0] === 'sendRollPreview')).toBe(false);
  });
});
