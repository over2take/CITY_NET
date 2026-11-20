import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InitiativeWindow } from '../components/InitiativeWindow';
import type { InitiativeState } from '../hooks/useInitiative';
import type { TurnAsk } from '../../../sheets/turnAsks';

// A condition's EACH TURN at the tracker (8a9c; approved mockup docs/mockups/condition-turn-effects.html): BEGIN ROUND 1
// in NEXT's place until the round has begun, where the game's conditions act on turns; an NPC's roll on its row for the GM;
// a player's said beside NEXT, which never waits on it. In D&D style and group style alike.

const props = (over = {}) => ({
  state: null as InitiativeState | null, activeCombats: [], sceneKey: 'city:0', sceneLabel: 'CITY MAP', isAdmin: true,
  onClose: vi.fn(), onStart: vi.fn(), onListCombats: vi.fn(), onNext: vi.fn(), onBegin: vi.fn(), onEnd: vi.fn(),
  onRemove: vi.fn(), onReorder: vi.fn(), onRollAsk: vi.fn(), system: 'generic', ...over,
});
const fighters = [
  { id: 'player:kes', name: 'Kes', score: 15, isNpc: false },
  { id: 'npc:7', name: 'Ganger', score: 9, isNpc: true },
];
const state = (over: Partial<InitiativeState> = {}): InitiativeState => ({
  sceneKey: 'city:0', combatId: 1, combatants: fighters, sides: [], turnIndex: 0, turnCounter: 1, passCounter: 1,
  system: 'generic', mode: 'individual', begun: false, turnEffects: true, ...over,
});
const sided = (over: Partial<InitiativeState> = {}) => state({
  mode: 'side', system: 'cities_without_number',
  combatants: [{ ...fighters[0], sideId: 'pc' }, { ...fighters[1], sideId: 'npc' }],
  sides: [{ id: 'pc', name: 'PLAYERS', score: 6, isPlayerSide: true }, { id: 'npc', name: 'NPC', score: 4, isPlayerSide: false }],
  ...over,
});
const ask = (over: Partial<TurnAsk>): TurnAsk => ({
  id: 11, sceneKey: 'city:0', locationId: 7, player: null, who: 'GANGER (NPC)', named: 'POISONED SAVE',
  condition: { id: 'poisoned', name: 'Poisoned' }, says: 'POISONED SAVE, END OF ITS TURN: d20, 13 or more ends it', moment: 'turn_end', ...over,
});
const row = (name: RegExp) => screen.getAllByTestId('initiative-row').find((r) => name.test(r.textContent || ''))!;

beforeEach(() => vi.clearAllMocks());

describe.each([['D&D style', state], ['group style', sided]] as const)('%s', (_style, make) => {
  it('not begun where the game acts on turns: ROUND 1 · NOT BEGUN, BEGIN ROUND 1 in NEXT\'s place, pressed once', async () => {
    const p = props({ state: make() });
    render(<InitiativeWindow {...p} />);
    expect(screen.getByText('ROUND 1 · NOT BEGUN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'NEXT' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'BEGIN ROUND 1' }));
    expect(p.onBegin).toHaveBeenCalledTimes(1);
    expect(p.onNext).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^END / })).toBeInTheDocument();
  });

  it('begun, or a game whose conditions do nothing on turns: NEXT as always', () => {
    const { unmount } = render(<InitiativeWindow {...props({ state: make({ begun: true }) })} />);
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^BEGIN/ })).toBeNull();
    expect(screen.getByText('ROUND 1')).toBeInTheDocument();
    unmount();
    render(<InitiativeWindow {...props({ state: make({ turnEffects: false }) })} />);
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeInTheDocument();
    expect(screen.queryByText(/NOT BEGUN/)).toBeNull();
  });

  it('a player never sees BEGIN, NOT BEGUN or the GM\'s rolls', () => {
    render(<InitiativeWindow {...props({ state: make(), isAdmin: false, asks: [ask({}), ask({ id: 12, player: 'kes', who: 'KES' })] })} />);
    expect(screen.queryByRole('button', { name: /^BEGIN/ })).toBeNull();
    expect(screen.queryByText(/NOT BEGUN/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^ROLL/ })).toBeNull();
    expect(screen.queryByTestId('initiative-waiting')).toBeNull();
  });

  it('an NPC\'s roll on its row for the GM, said in full on hover; pressed, rolled; waiting for the answer, not again', async () => {
    const p = props({ state: make({ begun: true }), asks: [ask({}), ask({ id: 12, player: 'kes', who: 'KES' }), ask({ id: 13, sceneKey: '5:0' })] });
    const { rerender } = render(<InitiativeWindow {...p} />);
    const roll = within(row(/GANGER/)).getByRole('button', { name: 'ROLL · POISONED SAVE' });
    expect(roll).toHaveAttribute('title', 'POISONED SAVE, END OF ITS TURN: d20, 13 or more ends it');
    // One button: not the player's, not the other fight's; none on the player's row.
    expect(screen.getAllByRole('button', { name: /^ROLL/ })).toHaveLength(1);
    expect(within(row(/KES/)).queryByRole('button', { name: /^ROLL/ })).toBeNull();
    await userEvent.click(roll);
    expect(p.onRollAsk).toHaveBeenCalledWith(11);
    rerender(<InitiativeWindow {...p} rolling={[11]} />);
    expect(within(row(/GANGER/)).getByRole('button', { name: 'ROLL · POISONED SAVE' })).toBeDisabled();
  });

  it('a player\'s roll waiting: said beside NEXT, which still works; a refused roll said in words', async () => {
    const p = props({ state: make({ begun: true }), asks: [ask({ id: 12, player: 'kes', who: 'KES' })], askError: 'That roll isn\'t waiting any more' });
    render(<InitiativeWindow {...p} />);
    expect(screen.getByTestId('initiative-waiting')).toHaveTextContent("WAITING ON KES'S POISONED SAVE");
    expect(screen.getByRole('alert')).toHaveTextContent('That roll isn\'t waiting any more');
    await userEvent.click(screen.getByRole('button', { name: 'NEXT' }));
    expect(p.onNext).toHaveBeenCalledTimes(1);
  });
});

describe('the round\'s own word and number', () => {
  it('a custom game\'s word for the round, and Shadowrun\'s pass count, on BEGIN', () => {
    render(<InitiativeWindow {...props({ state: state({ system: 'shadowrun_6e', passCounter: 3 }) })} />);
    expect(screen.getByRole('button', { name: 'BEGIN PASS 3' })).toBeInTheDocument();
    expect(screen.getByText('PASS 3 · NOT BEGUN')).toBeInTheDocument();
  });

  it('Shadowrun\'s everyone-rolls-again: CLEAR first, BEGIN after', () => {
    render(<InitiativeWindow {...props({ state: state({ system: 'shadowrun_6e', combatants: [], newRound: true }) })} />);
    expect(screen.getByRole('button', { name: 'CLEAR' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^BEGIN/ })).toBeNull();
  });

  it('no one in the order yet: BEGIN waits for them, and NEXT, in either style', () => {
    const { unmount } = render(<InitiativeWindow {...props({ state: state({ combatants: [] }) })} />);
    expect(screen.getByRole('button', { name: 'BEGIN ROUND 1' })).toBeDisabled();
    unmount();
    const again = render(<InitiativeWindow {...props({ state: state({ combatants: [], begun: true }) })} />);
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeDisabled();
    again.unmount();
    render(<InitiativeWindow {...props({ state: sided({ combatants: [], sides: [], begun: true }) })} />);
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeDisabled();
  });

  it('someone in the order: NEXT goes, in either style', () => {
    const { unmount } = render(<InitiativeWindow {...props({ state: state({ begun: true }) })} />);
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled();
    unmount();
    render(<InitiativeWindow {...props({ state: sided({ begun: true }) })} />);
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled();
  });
});
