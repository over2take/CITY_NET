import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { BuilderTour, tourPlace, TOUR_WIDTH } from '../BuilderTour';
import { TOUR } from '../../sheets/builderHelp';

/**
 * The builder's tour box (4i; approved mockup docs/mockups/builder-help.html, 2026-10-13): where it
 * sits, and what it says at a step. Lighting the rail and remembering it are BuilderScreen's (its
 * tests).
 */

afterEach(() => cleanup());

const SCREEN = { width: 1200, height: 800 };

describe('where the box goes', () => {
  it('the welcome, pointing at nothing, in the middle of the upper screen', () => {
    expect(tourPlace(null, SCREEN, 220)).toEqual({ left: (1200 - TOUR_WIDTH) / 2, top: 160 });
    expect(tourPlace(null, { width: 300, height: 50 }, 220)).toEqual({ left: 16, top: 16 });
  });

  it('beside the rail held open, level with the button, its arrow at the button', () => {
    expect(tourPlace({ top: 300 }, SCREEN, 220)).toEqual({ left: 234, top: 290, arrow: 18 });
  });

  it('never off the top or the bottom, the arrow still at the button', () => {
    expect(tourPlace({ top: 4 }, SCREEN, 220)).toEqual({ left: 234, top: 16, arrow: 12 });
    const low = tourPlace({ top: 760 }, SCREEN, 220);
    expect(low.top).toBe(800 - 220 - 16);
    expect(low).toMatchObject({ arrow: 220 - 24 });
    expect(tourPlace({ top: 600 }, SCREEN, 220)).toMatchObject({ top: 564, arrow: 44 });
  });
});

describe('the box', () => {
  const draw = (step: number, over = {}) => {
    const props = { onBack: vi.fn(), onNext: vi.fn(), onSkip: vi.fn() };
    render(<BuilderTour step={step} railWidth={220} root={() => document.body} {...props} {...over} />);
    return props;
  };

  it('says the step, its title and words, read out with the dialog', () => {
    draw(2);
    const dialog = screen.getByRole('dialog', { name: 'The builder tour' });
    expect(screen.getByText('STEP 3 OF 8')).toBeTruthy();
    expect(screen.getByRole('heading').textContent).toBe(TOUR[2].title);
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe(TOUR[2].text);
  });

  it('beside the button its step points at, found in the builder', () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-tour-place', 'words');
    btn.getBoundingClientRect = () => ({ top: 300 } as DOMRect);
    document.body.appendChild(btn);
    draw(2);
    const style = screen.getByRole('dialog').style;
    expect([style.left, style.top]).toEqual(['234px', '290px']);
    btn.remove();
  });

  it('BACK only after the first, DONE on the last, each calling back', () => {
    const first = draw(0);
    expect(screen.queryByRole('button', { name: 'BACK' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NEXT' }));
    expect(first.onNext).toHaveBeenCalledTimes(1);
    cleanup();
    const last = draw(TOUR.length - 1);
    fireEvent.click(screen.getByRole('button', { name: 'BACK' }));
    fireEvent.click(screen.getByRole('button', { name: 'DONE' }));
    fireEvent.click(screen.getByRole('button', { name: 'SKIP THE TOUR' }));
    expect([last.onBack, last.onNext, last.onSkip].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('Escape skips it, and goes no further', () => {
    let reached = false;
    const props = { onBack: vi.fn(), onNext: vi.fn(), onSkip: vi.fn() };
    render(<div onKeyDown={() => { reached = true; }}><BuilderTour step={1} railWidth={220} root={() => document.body} {...props} /></div>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'NEXT' }), { key: 'Escape' });
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(reached).toBe(false);
    fireEvent.keyDown(screen.getByRole('button', { name: 'NEXT' }), { key: 'Enter' });
    expect(props.onSkip).toHaveBeenCalledTimes(1);
  });
});
