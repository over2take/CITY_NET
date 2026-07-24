import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InitiativeNavPanel, sceneLabel } from '../components/InitiativeNavPanel';
import type { ActiveCombat } from '../hooks/useInitiative';

const locations = [
  { id: 42, name: 'Neon Plaza' },
  { id: 7, name: 'Warehouse' },
];

const baseProps = (overrides = {}) => ({
  initiativeActive: false,
  activeCombats: [] as ActiveCombat[],
  locations,
  onRollEnemies: vi.fn(),
  onRollFriendlies: vi.fn(),
  onToggleTracker: vi.fn(),
  onJumpToScene: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('sceneLabel helper', () => {
  it('returns CITY MAP for city:0', () => {
    expect(sceneLabel('city:0', [])).toBe('CITY MAP');
  });

  it('returns location name + LEVEL 0 for floor 0 (fallback; real label comes from server)', () => {
    expect(sceneLabel('42:0', locations)).toBe('NEON PLAZA — LEVEL 0');
  });

  it('returns location name + LEVEL N for higher floors', () => {
    expect(sceneLabel('42:2', locations)).toBe('NEON PLAZA — LEVEL 2');
  });

  it('falls back to MAP id when location not found', () => {
    expect(sceneLabel('99:1', locations)).toBe('MAP 99 — LEVEL 1');
  });
});

describe('InitiativeNavPanel — structure', () => {
  it('renders without crashing', () => {
    expect(() => render(<InitiativeNavPanel {...baseProps()} />)).not.toThrow();
  });

  it('shows INITIATIVE header', () => {
    render(<InitiativeNavPanel {...baseProps()} />);
    expect(screen.getByText('INITIATIVE')).toBeInTheDocument();
  });

  it('shows ROLL ENEMIES and ROLL FRIENDLIES buttons', () => {
    render(<InitiativeNavPanel {...baseProps()} />);
    expect(screen.getByText('ROLL ENEMIES')).toBeInTheDocument();
    expect(screen.getByText('ROLL FRIENDLIES')).toBeInTheDocument();
  });

  it('shows OPEN TRACKER button', () => {
    render(<InitiativeNavPanel {...baseProps()} />);
    expect(screen.getByText('OPEN TRACKER')).toBeInTheDocument();
  });

  it('shows ACTIVE COMBATS section header', () => {
    render(<InitiativeNavPanel {...baseProps()} />);
    expect(screen.getByText('ACTIVE COMBATS')).toBeInTheDocument();
  });
});

describe('InitiativeNavPanel — roll buttons enabled/disabled', () => {
  it('ROLL ENEMIES is disabled when no initiative active', () => {
    render(<InitiativeNavPanel {...baseProps({ initiativeActive: false })} />);
    expect(screen.getByText('ROLL ENEMIES')).toBeDisabled();
  });

  it('ROLL FRIENDLIES is disabled when no initiative active', () => {
    render(<InitiativeNavPanel {...baseProps({ initiativeActive: false })} />);
    expect(screen.getByText('ROLL FRIENDLIES')).toBeDisabled();
  });

  it('ROLL ENEMIES is enabled when initiative is active', () => {
    render(<InitiativeNavPanel {...baseProps({ initiativeActive: true })} />);
    expect(screen.getByText('ROLL ENEMIES')).not.toBeDisabled();
  });

  it('ROLL FRIENDLIES is enabled when initiative is active', () => {
    render(<InitiativeNavPanel {...baseProps({ initiativeActive: true })} />);
    expect(screen.getByText('ROLL FRIENDLIES')).not.toBeDisabled();
  });

  it('calls onRollEnemies when clicked and active', async () => {
    const props = baseProps({ initiativeActive: true });
    render(<InitiativeNavPanel {...props} />);
    await userEvent.click(screen.getByText('ROLL ENEMIES'));
    expect(props.onRollEnemies).toHaveBeenCalled();
  });

  it('calls onRollFriendlies when clicked and active', async () => {
    const props = baseProps({ initiativeActive: true });
    render(<InitiativeNavPanel {...props} />);
    await userEvent.click(screen.getByText('ROLL FRIENDLIES'));
    expect(props.onRollFriendlies).toHaveBeenCalled();
  });
});

describe('InitiativeNavPanel — OPEN TRACKER', () => {
  it('calls onToggleTracker when OPEN TRACKER is clicked', async () => {
    const props = baseProps();
    render(<InitiativeNavPanel {...props} />);
    await userEvent.click(screen.getByText('OPEN TRACKER'));
    expect(props.onToggleTracker).toHaveBeenCalled();
  });
});

describe('InitiativeNavPanel — close button', () => {
  it('calls onClose when ◀ is clicked', async () => {
    const props = baseProps();
    render(<InitiativeNavPanel {...props} />);
    await userEvent.click(screen.getByText('◀'));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('InitiativeNavPanel — empty combats placeholder', () => {
  it('shows placeholder text when no active combats', () => {
    render(<InitiativeNavPanel {...baseProps()} />);
    expect(screen.getByText(/NO ACTIVE COMBATS/)).toBeInTheDocument();
    expect(screen.getByText(/OPEN THE TRACKER AND CLICK START INITIATIVE TO BEGIN/)).toBeInTheDocument();
  });

  it('does not show combat entries when list is empty', () => {
    render(<InitiativeNavPanel {...baseProps()} />);
    expect(screen.queryByText(/COMBAT #/)).not.toBeInTheDocument();
  });
});

describe('InitiativeNavPanel — active combats list', () => {
  const combats: ActiveCombat[] = [
    { id: 1, turn_counter: 3, scene_keys: ['city:0', '42:0'], scene_labels: { 'city:0': 'CITY MAP', '42:0': 'NEON PLAZA — GROUND FLOOR' } },
    { id: 2, turn_counter: 1, scene_keys: ['7:2'], scene_labels: { '7:2': 'WAREHOUSE — LEVEL 2' } },
  ];

  it('does not show placeholder when combats exist', () => {
    render(<InitiativeNavPanel {...baseProps({ activeCombats: combats })} />);
    expect(screen.queryByText(/NO ACTIVE COMBATS/)).not.toBeInTheDocument();
  });

  it('shows combat ID and turn counter for each combat', () => {
    render(<InitiativeNavPanel {...baseProps({ activeCombats: combats })} />);
    expect(screen.getByText(/COMBAT #1 — TURN 3/)).toBeInTheDocument();
    expect(screen.getByText(/COMBAT #2 — TURN 1/)).toBeInTheDocument();
  });

  it('shows CITY MAP scene button', () => {
    render(<InitiativeNavPanel {...baseProps({ activeCombats: combats })} />);
    expect(screen.getByText(/CITY MAP/)).toBeInTheDocument();
  });

  it('shows server-provided scene labels for battle map scenes', () => {
    render(<InitiativeNavPanel {...baseProps({ activeCombats: combats })} />);
    expect(screen.getByText(/NEON PLAZA — GROUND FLOOR/)).toBeInTheDocument();
    expect(screen.getByText(/WAREHOUSE — LEVEL 2/)).toBeInTheDocument();
  });

  it('calls onJumpToScene with the correct sceneKey when a scene is clicked', async () => {
    const props = baseProps({ activeCombats: combats });
    render(<InitiativeNavPanel {...props} />);
    await userEvent.click(screen.getByText(/CITY MAP/));
    expect(props.onJumpToScene).toHaveBeenCalledWith('city:0');
  });

  it('calls onJumpToScene with battle map sceneKey', async () => {
    const props = baseProps({ activeCombats: combats });
    render(<InitiativeNavPanel {...props} />);
    await userEvent.click(screen.getByText(/NEON PLAZA — GROUND FLOOR/));
    expect(props.onJumpToScene).toHaveBeenCalledWith('42:0');
  });
});
