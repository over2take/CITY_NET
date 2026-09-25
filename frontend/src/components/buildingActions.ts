// Which buttons a building's window offers, to whom, and what each one does.
//
// Pure, with what the buttons reach for handed in, so a test can check every viewer's list
// and press every button - the same arrangement as tokenActions.ts. The conditions are the
// old window's, carried over one for one.

export type BuildingActionKey = 'shop' | 'battle' | 'ping' | 'broadcast' | 'enemy-vehicles' | 'request-edit';

export interface BuildingViewer {
  /** The building trades, and shops exist in this game system. */
  shopHere: boolean;
  hasBattleMaps: boolean;
  /** Signed in as the GM (main or granted). */
  isAdmin: boolean;
  /** The running system has vehicles at all. */
  systemHasVehicles: boolean;
}

export function buildingActionKeys(v: BuildingViewer): BuildingActionKey[] {
  const keys: BuildingActionKey[] = [];
  if (v.shopHere) keys.push('shop');
  if (v.hasBattleMaps) keys.push('battle');
  keys.push('ping');
  if (v.isAdmin) keys.push('broadcast');
  // The enemy roster never reaches a player's client at all.
  if (v.isAdmin && v.systemHasVehicles) keys.push('enemy-vehicles');
  // A player asks the GM for editing rights; the GM already has them.
  if (!v.isAdmin) keys.push('request-edit');
  return keys;
}

export interface BuildingActionContext {
  location: any;
  userName: string;
  emit: (event: string, payload: unknown) => void;
  /** Someone already holds editing rights, so a request would only be refused. */
  someoneEditing: boolean;
  notify: (message: string) => void;
  open: {
    shop: (location: any) => void;
    battleMap: (locationId: number) => void;
    enemyVehicles: () => void;
  };
  ping: () => void;
  broadcast: () => void;
}

const LABEL: Record<BuildingActionKey, string> = {
  shop: 'SHOP', battle: 'ENTER BATTLE MAP', ping: 'BROADCAST PING', broadcast: 'BROADCAST_THIS',
  'enemy-vehicles': 'ENEMY VEHICLES', 'request-edit': 'REQUEST_EDITING_RIGHTS',
};

export interface BuiltBuildingAction {
  key: BuildingActionKey;
  label: string;
  onClick: () => void;
  title?: string;
  tone?: 'primary' | 'normal' | 'accent' | 'danger';
}

export function buildBuildingActions(viewer: BuildingViewer, c: BuildingActionContext): BuiltBuildingAction[] {
  const loc = c.location;
  const does: Record<BuildingActionKey, Omit<BuiltBuildingAction, 'key' | 'label'>> = {
    shop: { tone: 'primary', onClick: () => c.open.shop(loc) },
    battle: { tone: 'accent', onClick: () => c.open.battleMap(loc.id) },
    ping: { title: 'Show everyone where this is', onClick: () => c.ping() },
    broadcast: { title: 'Point the stream camera at this object', onClick: () => c.broadcast() },
    'enemy-vehicles': { title: 'Enemy vehicles, kept on NPC sheets between sessions', onClick: () => c.open.enemyVehicles() },
    'request-edit': {
      onClick: () => {
        if (c.someoneEditing) { c.notify('ANOTHER_USER_ACCESSING_DATA_POINTS'); return; }
        c.emit('requestEditing', { userId: c.userName, userName: c.userName, locationId: loc.id, locationName: loc.name });
        c.notify('REQUEST_SENT_TO_ADMIN');
      },
    },
  };
  return buildingActionKeys(viewer).map((key) => ({ key, label: LABEL[key], ...does[key] }));
}
