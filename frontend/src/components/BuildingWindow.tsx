import { TerminalWindow, TERMINAL_PREVIEW, useFolder, type TerminalAction, type TerminalFolder } from './TerminalWindow';
import { BuildingPreview } from './BuildingPreview';
import { buildingTypeById, typeLabel } from '../data/buildingTypes';
import { GmNotes } from './GmNotes';

// A building's info window, drawn as a terminal: folders down the left, the open one's
// text on the right, and the building itself in the corner.
//
// Only for buildings. Player and NPC tokens have TokenWindow, on the same layout - they
// carry a portrait, armor class, attacks and a sheet, none of which a building has.
//
// It shows exactly the fields the old window did, read from the same columns. Nothing
// about how a building is stored changes to draw it this way; the photo and the GM's notes
// are additions that sit beside those fields rather than replacing any of them.

export type BuildingTab = 'info' | 'residents' | 'gm';

/** A button along the bottom. The caller decides which apply; the window only lays them out. */
export type BuildingAction = TerminalAction;

interface Props {
  location: any;
  /** The building's other parts - locations whose parent is this one - for the render. */
  parts?: any[];
  title: string;
  gameSystem: string;
  pos: { x: number; y: number };
  setPos: (p: { x: number; y: number }) => void;
  onClose: () => void;
  actions: BuildingAction[];
  /**
   * The main admin, who alone may read the GM's notes. Not merely "signed in as admin": a
   * player the GM granted editing rights holds an admin token too, and the server refuses
   * them the notes, so offering the tab would only show them an error.
   */
  isPrimaryAdmin: boolean;
  /** The admin token, for reading and saving the notes. */
  token: string;
}

export function BuildingWindow({
  location, parts = [], title, gameSystem, pos, setPos, onClose, actions, isPrimaryAdmin, token,
}: Props) {
  const folders: TerminalFolder<BuildingTab>[] = [
    { id: 'info', label: 'INFO' },
    { id: 'residents', label: 'RESIDENTS' },
    ...(isPrimaryAdmin ? [{ id: 'gm' as const, label: 'GM NOTES' }] : []),
  ];
  // Opening another building starts at its INFO, not wherever the last one was left.
  const [open, setOpen] = useFolder(folders, location?.id);

  const type = buildingTypeById(location?.building_type);

  return (
    <TerminalWindow
      title={title}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      preview={<BuildingPreview location={location} parts={parts} width={TERMINAL_PREVIEW.width} height={TERMINAL_PREVIEW.height} />}
      folders={folders}
      open={open}
      onOpen={setOpen}
      actions={actions}
      header={(
        <>
          {open === 'info' && (
            <>
              {type ? typeLabel(type.id, gameSystem).toUpperCase() : 'BUILDING'}
              {location?.district_name ? ` · ${String(location.district_name).toUpperCase()}` : ''}
            </>
          )}
          {open === 'residents' && 'KNOWN RESIDENTS'}
          {open === 'gm' && 'GM ONLY · PLAYERS NEVER SEE THIS'}
        </>
      )}
    >
      {open === 'info' && (location?.description || 'NO_DATA')}
      {open === 'residents' && (location?.npcs || 'UNKNOWN')}
      {open === 'gm' && <GmNotes locationId={location?.id} token={token} />}
    </TerminalWindow>
  );
}
