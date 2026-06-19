export interface Point {
  x: number
  y: number
}

export interface Wall {
  id: string
  start: Point
  end: Point
  thickness: number
  height: number
  color?: string
  dimension_offset?: number
  wall_type?: string
  curved?: boolean
}

export interface Opening {
  id: string
  wall_id: string
  type: 'door' | 'window' | 'gate'
  offset: number
  width: number
  swing: 'left' | 'right'
  rotation?: number
  height?: number
  elevation?: number
  trim?: number
  door_style?: 'hinged' | 'double' | 'sliding' | 'opening' | 'pocket' | 'bifold' | 'garage' | 'fixed' | 'barn' | 'shower'
  mount?: 'center' | 'interior' | 'exterior'
  swing_direction?: 'in' | 'out'
  swing_angle?: number
  door_open?: boolean
  handle_style?: 'knob' | 'lever' | 'bar' | 'none'
  window_style?: 'awning' | 'bay' | 'bow' | 'casement' | 'cottage' | 'center_pivot' | 'dormer' | 'double_hung' | 'egress' | 'fixed' | 'french' | 'garden' | 'hopper' | 'glass_block' | 'jalousie' | 'lunette' | 'oriel' | 'palladian' | 'picture' | 'radius' | 'round' | 'single_hung' | 'skylight' | 'storm' | 'three_panel_slider' | 'tilt_turn' | 'transom' | 'two_panel_slider'
  frame_color?: string
  panel_color?: string
  build_variant?: string
}

export interface PlacedObject {
  id: string
  type: string
  label: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  color: string
  elevation?: number
  font_size?: number
  build_variant?: string
  stair_shape?: 'straight' | 'landing' | 'return_landing'
  landing_width?: number
  landing_depth?: number
  left_run_width?: number
  right_run_width?: number
  /** @deprecated Legacy stair dimensions retained for saved-plan compatibility. */
  leftRunWidth?: number
  /** @deprecated Legacy stair dimensions retained for saved-plan compatibility. */
  rightRunWidth?: number
  /** @deprecated Use landing_width. */
  landingWidth?: number
  landing_turn?: 'left' | 'right'
  stair_height?: number
  stair_steps?: number
}

export interface FloorPlan {
  walls: Wall[]
  openings: Opening[]
  objects: PlacedObject[]
  canvas_width: number
  canvas_height: number
  grid_size: number
  floors?: FloorLevel[]
  active_floor_id?: string
}

export interface FloorLevel {
  id: string
  name: string
  level: number
  walls: Wall[]
  openings: Opening[]
  objects: PlacedObject[]
  canvas_width: number
  canvas_height: number
  grid_size: number
}

export interface Project {
  id: string
  name: string
  description: string
  floor_plan: FloorPlan
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  wall_count: number
  object_count: number
}

export interface User {
  id: string
  email: string
  username: string
}

export interface AuthState {
  user: User | null
  token: string | null
}

export type Tool = 'select' | 'wall' | 'door' | 'doubleDoor' | 'stairs' | 'gate' | 'window' | 'object' | 'text' | 'delete' | 'pan'

export const FURNITURE_PRESETS: Array<{
  type: string
  label: string
  width: number
  height: number
  color: string
}> = [
  { type: 'sofa',     label: 'Sofa',       width: 160, height: 70,  color: '#8b7355' },
  { type: 'bed',      label: 'Double Bed', width: 140, height: 190, color: '#7a9e9f' },
  { type: 'bed_s',    label: 'Single Bed', width: 90,  height: 190, color: '#7a9e9f' },
  { type: 'table',    label: 'Dining Table',width: 120, height: 80,  color: '#b5835a' },
  { type: 'desk',     label: 'Desk',       width: 120, height: 60,  color: '#c4a882' },
  { type: 'chair',    label: 'Chair',      width: 55,  height: 55,  color: '#9e8c6b' },
  { type: 'stairs',   label: 'Stairs',     width: 120, height: 180, color: '#8f969c' },
  { type: 'wardrobe', label: 'Wardrobe',   width: 120, height: 55,  color: '#6d7a6e' },
  { type: 'bath',     label: 'Bathtub',    width: 70,  height: 150, color: '#a8c5da' },
  { type: 'toilet',   label: 'Toilet',     width: 40,  height: 65,  color: '#d4e4ec' },
  { type: 'sink',     label: 'Sink',       width: 55,  height: 45,  color: '#c8dce8' },
]
