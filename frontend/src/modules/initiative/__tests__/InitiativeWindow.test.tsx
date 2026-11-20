import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InitiativeWindow } from '../components/InitiativeWindow';
import type { InitiativeState, ActiveCombat } from '../hooks/useInitiative';

const baseProps = (overrides = {}) => ({
  state: null as InitiativeState | null,
  activeCombats: [] as ActiveCombat[],
  sceneKey: 'city:0',
  sceneLabel: 'CITY MAP',
  isAdmin: true,
  onClose: vi.fn(),
  onStart: vi.fn(),
  onListCombats: vi.fn(),
  onNext: vi.fn(),
  onEnd: vi.fn(),
  onRemove: vi.fn(),
  onReorder: vi.fn(),
  ...overrides,
});

const makeState = (overrides = {}): InitiativeState => ({
  sceneKey: 'city:0',
  combatId: 1,
  combatants: [],
  turnIndex: 0,
  turnCounter: 1,
  passCounter: 1,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('InitiativeWindow — no active initiative', () => {
  it('renders without crashing', () => {
    expect(() => render(<InitiativeWindow {...baseProps()} />)).not.toThrow();
  });

  it('shows START INITIATIVE button when admin and no state', () => {
    render(<InitiativeWindow {...baseProps()} />);
    expect(screen.getByText('START INITIATIVE')).toBeInTheDocument();
  });

  it('calls onStart when START INITIATIVE is clicked', async () => {
    const props = baseProps();
    render(<InitiativeWindow {...props} />);
    await userEvent.click(screen.getByText('START INITIATIVE'));
    expect(props.onStart).toHaveBeenCalled();
  });

  it('does not show START INITIATIVE for non-admin', () => {
    render(<InitiativeWindow {...baseProps({ isAdmin: false })} />);
    expect(screen.queryByText('START INITIATIVE')).not.toBeInTheDocument();
    expect(screen.getByText(/NO ACTIVE INITIATIVE/)).toBeInTheDocument();
  });

  it('shows JOIN EXISTING COMBAT when activeCombats available', () => {
    const combats: ActiveCombat[] = [{ id: 1, scene_keys: ['map:1:0'], scene_counters: { 'map:1:0': 3 } }];
    render(<InitiativeWindow {...baseProps({ activeCombats: combats })} />);
    expect(screen.getByText('JOIN EXISTING COMBAT')).toBeInTheDocument();
  });

  it('shows combat list after clicking JOIN EXISTING COMBAT', async () => {
    const combats: ActiveCombat[] = [{ id: 1, scene_keys: ['map:1:0'], scene_counters: { 'map:1:0': 3 } }];
    render(<InitiativeWindow {...baseProps({ activeCombats: combats })} />);
    await userEvent.click(screen.getByText('JOIN EXISTING COMBAT'));
    // Joined at its own ROUND 1 (8a8): the combat by ID and its scenes, no count of its own.
    expect(screen.getByText('COMBAT #1 [1 SCENE]')).toBeInTheDocument();
  });

  it('calls onStart with combatId when joining existing combat', async () => {
    const props = baseProps({ activeCombats: [{ id: 2, scene_keys: [] }] });
    render(<InitiativeWindow {...props} />);
    await userEvent.click(screen.getByText('JOIN EXISTING COMBAT'));
    await userEvent.click(screen.getByText(/COMBAT #2/));
    expect(props.onStart).toHaveBeenCalledWith(2);
  });
});

describe('InitiativeWindow — active initiative', () => {
  it('shows the ROUND counter in title (Generic counted TURNs before 8a8)', () => {
    render(<InitiativeWindow {...baseProps({ state: makeState({ turnCounter: 3 }) })} />);
    expect(screen.getByText('ROUND 3')).toBeInTheDocument();
  });

  it('shows WAITING FOR ROLLS when combatants list is empty', () => {
    render(<InitiativeWindow {...baseProps({ state: makeState() })} />);
    expect(screen.getByText(/WAITING FOR ROLLS/)).toBeInTheDocument();
  });

  it('shows combatant names', () => {
    const state = makeState({
      combatants: [
        { id: 'a', name: 'Alice', score: 18, isNpc: false },
        { id: 'b', name: 'Bob', score: 12, isNpc: true },
      ],
    });
    render(<InitiativeWindow {...baseProps({ state })} />);
    expect(screen.getByText(/ALICE/)).toBeInTheDocument();
    expect(screen.getByText(/BOB/)).toBeInTheDocument();
  });

  it('shows scores', () => {
    const state = makeState({
      combatants: [{ id: 'a', name: 'Alice', score: 18, isNpc: false }],
    });
    render(<InitiativeWindow {...baseProps({ state })} />);
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  it('calls onNext when NEXT is clicked', async () => {
    const props = baseProps({
      state: makeState({ combatants: [{ id: 'a', name: 'Alice', score: 18, isNpc: false }] }),
    });
    render(<InitiativeWindow {...props} />);
    await userEvent.click(screen.getByText('NEXT'));
    expect(props.onNext).toHaveBeenCalled();
  });

  it('calls onEnd when END INIT is clicked', async () => {
    const props = baseProps({ state: makeState() });
    render(<InitiativeWindow {...props} />);
    await userEvent.click(screen.getByText('END INIT'));
    expect(props.onEnd).toHaveBeenCalled();
  });

  it('does not show NEXT or END INIT for non-admin', () => {
    render(<InitiativeWindow {...baseProps({ state: makeState(), isAdmin: false })} />);
    expect(screen.queryByText('NEXT')).not.toBeInTheDocument();
    expect(screen.queryByText('END INIT')).not.toBeInTheDocument();
  });

  it('calls onRemove when trash button is clicked', async () => {
    const props = baseProps({
      state: makeState({ combatants: [{ id: 'a', name: 'Alice', score: 18, isNpc: false }] }),
    });
    render(<InitiativeWindow {...props} />);
    await userEvent.click(screen.getByTitle('REMOVE'));
    expect(props.onRemove).toHaveBeenCalledWith('a');
  });

  it('calls onClose when X button is clicked', async () => {
    const props = baseProps({ state: makeState() });
    render(<InitiativeWindow {...props} />);
    await userEvent.click(screen.getByText('×'));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('InitiativeWindow — whose turn it is (8i2)', () => {
  it('said on that row alone, for a screen reader and the journeys', () => {
    const combatants = [{ id: 'player:vex', name: 'VEX', score: 18 }, { id: 'npc:1', name: 'GANGER', score: 12 }, { id: 'player:kes', name: 'KES', score: 6 }];
    render(<InitiativeWindow {...baseProps({ state: makeState({ combatants, turnIndex: 1 }) })} />);
    const rows = screen.getAllByTestId('initiative-row');
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(rows[1].textContent).toContain('GANGER');
  });
});
