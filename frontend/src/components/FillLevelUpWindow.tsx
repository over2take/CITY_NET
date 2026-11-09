import React from 'react';
import { LevelUpFlow } from './LevelUpWindow';
import { useChoicesRefused } from '../hooks/useChoicesRefused';
import { useTheirSheet } from '../hooks/useTheirSheet';

// FILL IT IN FOR THEM for a level up (7d7a; approved mockup docs/mockups/level-up.html, 2026-11-07): the player's
// LEVEL_UP.EXE opened by the GM on that player's sheet, with every limit off, as creation's is (FillInForThemWindow).
// What it draws is the flow's own (LevelUpWindow.tsx); here is only whose sheet it reads, and that each action names them.

interface Props {
  token: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app's socket is untyped throughout
  socket: any;
  username: string;
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
}

export function FillLevelUpWindow({ token, socket, username, pos, setPos, onClose }: Props) {
  const { sheet, template } = useTheirSheet(token, socket, username);
  const refused = useChoicesRefused(socket);
  return (
    <LevelUpFlow gm sheet={sheet} template={template} refused={refused} name={username}
      emit={(action) => socket.emit('levelAction', { ...action, username })}
      pos={pos} setPos={setPos} onLeave={onClose} onDone={onClose} />
  );
}
