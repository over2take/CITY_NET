import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraggableWindow } from '../DraggableWindow';

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
