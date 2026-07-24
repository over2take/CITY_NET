import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InitiativeRollPrompt } from '../components/InitiativeRollPrompt';

const baseProps = (overrides = {}) => ({
  sceneLabel: 'CITY MAP',
  userName: 'GHOST',
  userId: 'GHOST',
  onRoll: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('InitiativeRollPrompt', () => {
  it('renders without crashing', () => {
    expect(() => render(<InitiativeRollPrompt {...baseProps()} />)).not.toThrow();
  });

  it('shows scene label', () => {
    render(<InitiativeRollPrompt {...baseProps({ sceneLabel: 'OMNI TOWER — LV 3' })} />);
    expect(screen.getByText('OMNI TOWER — LV 3')).toBeInTheDocument();
  });

  it('shows player name', () => {
    render(<InitiativeRollPrompt {...baseProps()} />);
    expect(screen.getByText('GHOST')).toBeInTheDocument();
  });

  it('shows ROLL button', () => {
    render(<InitiativeRollPrompt {...baseProps()} />);
    expect(screen.getByText('ROLL')).toBeInTheDocument();
  });

  it('shows 1d20 label', () => {
    render(<InitiativeRollPrompt {...baseProps()} />);
    expect(screen.getByText(/1d20/i)).toBeInTheDocument();
  });

  it('calls onRoll with a number between 1 and 20 when ROLL is clicked', async () => {
    const props = baseProps();
    render(<InitiativeRollPrompt {...props} />);
    await userEvent.click(screen.getByText('ROLL'));
    expect(props.onRoll).toHaveBeenCalledTimes(1);
    const score = props.onRoll.mock.calls[0][0];
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(20);
  });

  it('shows the rolled score after rolling', async () => {
    render(<InitiativeRollPrompt {...baseProps()} />);
    await userEvent.click(screen.getByText('ROLL'));
    expect(screen.getByText('ADDED TO TRACKER')).toBeInTheDocument();
    expect(screen.queryByText('ROLL')).not.toBeInTheDocument();
  });

  it('calls onClose when X button is clicked', async () => {
    const props = baseProps();
    render(<InitiativeRollPrompt {...props} />);
    await userEvent.click(screen.getByText('×'));
    expect(props.onClose).toHaveBeenCalled();
  });
});
