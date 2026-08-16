import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VehicleBadgeButton } from '../VehicleBadgeButton';

/**
 * The car badge on a sheet and a token menu.
 *
 * Shown for anyone's token, clickable only on your own — knowing that someone else is in
 * a car is the reason it is on their token at all, so it goes inert rather than hidden.
 * The server refuses the same thing independently; this only saves a round trip.
 */

const KESTREL = { name: 'Kestrel', moving: false };

const show = (props: Partial<React.ComponentProps<typeof VehicleBadgeButton>> = {}) => {
  const onDisembark = vi.fn();
  render(
    <VehicleBadgeButton
      vehicle={KESTREL}
      occupant="mouse"
      userName="mouse"
      onDisembark={onDisembark}
      {...props}
    />
  );
  return onDisembark;
};

describe('the vehicle badge', () => {
  it('shows nothing at all when on foot', () => {
    show({ vehicle: null });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads as the action, on your own', () => {
    show();
    // It is a button that does something, so it says what it does rather than restating
    // where you are.
    expect(screen.getByText('LEAVE KESTREL')).toBeInTheDocument();
  });

  it('reads as a statement on someone else’s, since it does nothing there', () => {
    show({ occupant: 'cody', userName: 'mouse', vehicle: { name: 'Kestrel', moving: true } });
    expect(screen.getByText(/KESTREL · MOVING/)).toBeInTheDocument();
    expect(screen.queryByText(/LEAVE/)).toBeNull();
  });

  it('gets you out of your own', async () => {
    const onDisembark = show();
    await userEvent.click(screen.getByRole('button'));
    expect(onDisembark).toHaveBeenCalledWith('mouse');
  });

  it('is inert on someone else’s, but still visible', async () => {
    const onDisembark = show({ occupant: 'cody', userName: 'mouse' });
    const button = screen.getByRole('button', { name: /In the Kestrel/ });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onDisembark).not.toHaveBeenCalled();
  });

  it('takes its colour from the theme rather than a fixed amber', () => {
    show();
    // The theme's own green, not the seat accent: the accent means "occupied" inside the
    // diagram, and a button among buttons should look like the ones beside it.
    expect(screen.getByRole('button').style.color).toBe('var(--green)');
  });

  it('sits on black in the title bar, where the bar is already the theme colour', () => {
    show({ compact: true });
    // An outline in a theme colour on a bar painted that colour is hard to read, and in
    // monochrome disappears entirely.
    const style = screen.getByRole('button').style;
    expect(style.background).toBe('var(--black)');
    expect(style.border).toBe('1px solid var(--black)');
  });

  it('lets the GM pull anyone out', async () => {
    const onDisembark = show({ occupant: 'cody', userName: 'gm', isAdmin: true });
    await userEvent.click(screen.getByRole('button'));
    expect(onDisembark).toHaveBeenCalledWith('cody');
  });
});
