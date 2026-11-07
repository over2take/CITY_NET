import React from 'react';
import { FlowWindow } from './NewCharacterWindow';
import { useChoicesRefused } from '../hooks/useChoicesRefused';
import { useTheirSheet } from '../hooks/useTheirSheet';

// FILL IT IN FOR THEM (7c5; approved mockup docs/mockups/new-character.html): the player's NEW_CHARACTER.EXE
// opened by the GM on that player's sheet, with every limit off. What it draws is the flow's own
// (NewCharacterWindow.tsx); here is only whose sheet it reads, and that each action names them.

interface Props {
  token: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app's socket is untyped throughout
  socket: any;
  username: string;
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
}

export function FillInForThemWindow({ token, socket, username, pos, setPos, onClose }: Props) {
  const { sheet, template, onField, flush, upload } = useTheirSheet(token, socket, username);
  const refused = useChoicesRefused(socket);
  return (
    <FlowWindow forPlayer={username} pos={pos} setPos={setPos} sheet={sheet} template={template} onField={onField} refused={refused} upload={upload}
      act={(action) => { void flush().then(() => socket.emit('creationAction', { ...action, username })); }}
      choose={(action) => socket.emit('choicesAction', { ...action, username })}
      onLeave={onClose} onDone={onClose} />
  );
}
