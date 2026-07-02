// ─── Core Map Data ────────────────────────────────────────────────────────────

export interface Location {
  id: number;
  name: string;
  description: string | null;
  npcs: string | null;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  shape: 'box' | 'cylinder' | 'sphere' | 'rhombus' | string;
  color: string;
  district_name: string | null;
  district_color: string | null;
  parent_id: number | null;
  is_target: number;
  isFavorite: number;
  isDanger: number;
  owner: string | null;
  notifications_enabled: number;
  rotation: number;
  rotation_x: number;
  rotation_z: number;
  classification: string | null;
  polyCount: number;
  battle_map_id: number | null;
  floor_index: number | null;
  hp_current: number | null;
  hp_max: number | null;
  hp_temp: number | null;
  map_scale_multiplier: number;
}

export interface District {
  id: number;
  name: string;
  color: string;
}

export interface Road {
  id: number;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
}

export interface WaterBody {
  id: number;
  points_json: string;
  points: { x: number; z: number }[];
  map_scale_multiplier: string;
}

export interface BattleMap {
  id: number;
  location_id: number;
  designation: string;
  image_url: string;
  order_index: number;
}

export interface SavedMap {
  id: number;
  name: string;
  timestamp: string;
}

// ─── Users & Session ──────────────────────────────────────────────────────────

export interface ActiveUser {
  userName: string;
  isAdmin: boolean;
  isTemporaryAdmin: boolean;
  isNPC?: boolean;
  isActive?: boolean;
  currentBattleMapId?: number | null;
  currentFloorIndex?: number | null;
}

export interface PendingRequest {
  userId: string;
  locationId: number;
}

// ─── Chat & Messaging ─────────────────────────────────────────────────────────

export interface ChatMessage {
  id: number;
  sender: string;
  text: string;
  timestamp: string;
}

export interface PrivateMessage {
  id: number;
  sender: string;
  recipient: string;
  text: string;
  timestamp: string;
}

// ─── Banking ──────────────────────────────────────────────────────────────────

export interface BankData {
  username: string;
  balance: number;
  debt: number;
}

// ─── Dice ─────────────────────────────────────────────────────────────────────

export interface DiceRoll {
  userName: string;
  total: number;
  results: Record<number, number[]>;
  color: string;
  historyString: string;
  timestamp?: number;
}

// ─── Battle Map Session ───────────────────────────────────────────────────────

export interface BattleMapSessionData {
  locationId: number;
  currentFloorIndex: number;
  maps: BattleMap[];
}

export interface BattleMapPosition {
  x: number;
  z: number;
}

// ─── UI State ─────────────────────────────────────────────────────────────────

export type AnimState = 'none' | 'appearing' | 'fading';

export type ViewMode =
  | 'list'
  | 'editor'
  | 'generator'
  | 'district'
  | 'join'
  | 'draw_roads'
  | 'draw_water'
  | 'city_gen'
  | 'battle_map';

export type SidebarMenu =
  | 'none'
  | 'quick_access'
  | 'nav_controls'
  | 'system_info'
  | 'geometry_protocols'
  | 'city_data_base'
  | 'dice_menu';

export interface CameraTarget {
  pos: [number, number, number];
  size: number;
}

export interface ConfirmDialog {
  title: string;
  message: string;
  onConfirm: () => void;
  confirmText?: string;
  isAlert?: boolean;
}

export interface RhombusState {
  active: boolean;
  name?: string;
  description?: string;
  color?: string;
  hp_max?: number;
}

export interface DragOffset {
  x: number;
  y: number;
}

// ─── Measurement ──────────────────────────────────────────────────────────────

export interface MeasurementPoint {
  x: number;
  y: number;
  z: number;
}

export interface MeasurementData {
  owner: string;
  start: MeasurementPoint;
  end: MeasurementPoint;
  color: string;
  battle_map_id: number | null;
  floor_index: number | null;
  map_scale_multiplier: number;
  view: ViewMode;
  locationId: number | null;
  isFinal: boolean;
  timestamp?: number;
}

// ─── Global Settings ──────────────────────────────────────────────────────────

export interface GlobalSetting {
  key: string;
  value: string;
}

export type GlobalSettings = Record<string, string>;
