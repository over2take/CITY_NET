import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraggableWindow } from '../DraggableWindow';
import { windowKey } from '../windowFocus';

const baseProps = {
  title: 'TEST_WINDOW',
  pos: { x: 100, y: 200 },
  setPos: vi.fn(),
  onClose: vi.fn(),
};

describe('DraggableWindow', () => {
  it('renders the title', () => {
    render(<DraggableWindow {...baseProps}><p>content</p></DraggableWindow>);
    expect(screen.getByText('TEST_WINDOW')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(<DraggableWindow {...baseProps}><p>hello world</p></DraggableWindow>);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('positions window using pos prop', () => {
    const { container } = render(<DraggableWindow {...baseProps}><span /></DraggableWindow>);
    const win = container.querySelector('.win95-window') as HTMLElement;
    expect(win.style.left).toBe('100px');
    expect(win.style.top).toBe('200px');
  });

  it('calls onClose when × button is clicked', async () => {
    const onClose = vi.fn();
    render(<DraggableWindow {...baseProps} onClose={onClose}><span /></DraggableWindow>);
    await userEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not render notification toggle when onToggleNotifications is not provided', () => {
    render(<DraggableWindow {...baseProps}><span /></DraggableWindow>);
    expect(screen.queryByTitle('TOGGLE_NOTIFICATIONS')).not.toBeInTheDocument();
  });

  it('renders notification toggle when onToggleNotifications is provided', () => {
    render(
      <DraggableWindow {...baseProps} onToggleNotifications={vi.fn()} notificationsEnabled={true}>
        <span />
      </DraggableWindow>
    );
    expect(screen.getByTitle('TOGGLE_NOTIFICATIONS')).toBeInTheDocument();
  });

  it('calls onToggleNotifications when toggle button is clicked', async () => {
    const onToggle = vi.fn();
    render(
      <DraggableWindow {...baseProps} onToggleNotifications={onToggle} notificationsEnabled={false}>
        <span />
      </DraggableWindow>
    );
    await userEvent.click(screen.getByTitle('TOGGLE_NOTIFICATIONS'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders titleControls slot', () => {
    render(
      <DraggableWindow {...baseProps} titleControls={<button>EXTRA</button>}>
        <span />
      </DraggableWindow>
    );
    expect(screen.getByText('EXTRA')).toBeInTheDocument();
  });

  it('updates position while dragging', () => {
    const setPos = vi.fn();
    render(<DraggableWindow {...baseProps} setPos={setPos}><span /></DraggableWindow>);
    const titleBar = document.querySelector('.win95-title-bar') as HTMLElement;

    fireEvent.mouseDown(titleBar, { clientX: 110, clientY: 210 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 250 });

    // dragOffset = (110-100, 210-200) = (10,10); new pos = (150-10, 250-10) = (140,240)
    expect(setPos).toHaveBeenCalledWith({ x: 140, y: 240 });
  });

  it('stops updating position after mouseup', () => {
    const setPos = vi.fn();
    render(<DraggableWindow {...baseProps} setPos={setPos}><span /></DraggableWindow>);
    const titleBar = document.querySelector('.win95-title-bar') as HTMLElement;

    fireEvent.mouseDown(titleBar, { clientX: 110, clientY: 210 });
    fireEvent.mouseUp(window);
    setPos.mockClear();
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });

    expect(setPos).not.toHaveBeenCalled();
  });
});

describe('like a desktop', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* no storage */ } });

  const two = (onCloseA = vi.fn(), onCloseB = vi.fn()) => {
    render(
      <>
        <DraggableWindow {...baseProps} title="A.EXE" onClose={onCloseA}><input aria-label="field" /></DraggableWindow>
        <DraggableWindow {...baseProps} title="B.EXE" onClose={onCloseB}><p>b</p></DraggableWindow>
      </>,
    );
    const win = (t: string) => screen.getByText(t).closest('.win95-window') as HTMLElement;
    return { win, onCloseA, onCloseB };
  };

  it('has one focused window, the newest, and draws the rest inactive', () => {
    const { win } = two();
    expect(win('B.EXE')).not.toHaveClass('inactive');
    expect(win('A.EXE')).toHaveClass('inactive');
  });

  it('focuses a window clicked anywhere in it', () => {
    const { win } = two();
    fireEvent.mouseDown(screen.getByLabelText('field'));
    expect(win('A.EXE')).not.toHaveClass('inactive');
    expect(win('B.EXE')).toHaveClass('inactive');
  });

  it('closes only the focused window on Esc', () => {
    const { onCloseA, onCloseB } = two();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();
  });

  it('leaves Esc to a field being typed in', () => {
    const { onCloseA, onCloseB } = two();
    const field = screen.getByLabelText('field');
    fireEvent.mouseDown(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onCloseA).not.toHaveBeenCalled();
    expect(onCloseB).not.toHaveBeenCalled();
  });

  it('hands focus to the next window down when the focused one closes', () => {
    const { rerender } = render(
      <>
        <DraggableWindow {...baseProps} title="A.EXE"><p>a</p></DraggableWindow>
        <DraggableWindow {...baseProps} title="B.EXE"><p>b</p></DraggableWindow>
      </>,
    );
    rerender(<><DraggableWindow {...baseProps} title="A.EXE"><p>a</p></DraggableWindow></>);
    expect(screen.getByText('A.EXE').closest('.win95-window')).not.toHaveClass('inactive');
  });

  it('opens where that kind of window was last left', () => {
    const first = vi.fn();
    const { unmount } = render(<DraggableWindow {...baseProps} title="SHOP.EXE · VIC" setPos={first}><span /></DraggableWindow>);
    fireEvent.mouseDown(document.querySelector('.win95-title-bar') as HTMLElement, { clientX: 110, clientY: 210 });
    fireEvent.mouseUp(window);
    unmount();
    // Another shop - the same program - opens where that one was left.
    const second = vi.fn();
    render(<DraggableWindow {...baseProps} title="SHOP.EXE · DOC WU" setPos={second}><span /></DraggableWindow>);
    expect(second).toHaveBeenCalledWith({ x: 100, y: 200 });
  });

  it('knows a window by the program name at the front of its title', () => {
    expect(windowKey("SHOP.EXE · VIC'S ARMS")).toBe('SHOP.EXE');
    expect(windowKey('CUSTOM_DIE.EXE · EDIT')).toBe('CUSTOM_DIE.EXE');
    expect(windowKey('BANK.EXE')).toBe('BANK.EXE');
  });
});
