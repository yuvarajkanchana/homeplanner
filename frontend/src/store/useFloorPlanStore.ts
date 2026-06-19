import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Wall, Opening, PlacedObject, FloorPlan, FloorLevel, Tool } from '../types/schema'

export type MeasurementUnit = 'm' | 'ft' | 'in'
export type WallMeasurementMode = 'outer' | 'none' | 'all'

interface FloorPlanStore {
  // State
  walls: Wall[]
  openings: Opening[]
  objects: PlacedObject[]
  canvas_width: number
  canvas_height: number
  grid_size: number
  floors: FloorLevel[]
  activeFloorId: string
  selectedId: string | null
  activeTool: Tool
  buildPreset: string | null
  measurementUnit: MeasurementUnit
  wallMeasurementMode: WallMeasurementMode
  isDirty: boolean
  updateOpening: (id: string, updates: Partial<Opening>) => void

  // History for undo
  history: FloorPlan[]
  historyIndex: number
  future: FloorPlan[]

  // Tool
  setTool: (t: Tool) => void
  setBuildPreset: (preset: string | null) => void
  setSelected: (id: string | null) => void
  setGridSize: (size: number) => void
  addFloor: () => void
  setActiveFloor: (id: string) => void
  toggleMeasurementUnit: () => void
  toggleWallMeasurementMode: () => void

  // Walls
  addWall: (wall: Omit<Wall, 'id'>) => Wall
  updateWall: (id: string, updates: Partial<Wall>) => void
  removeWall: (id: string) => void

  // Openings
  addOpening: (opening: Omit<Opening, 'id'>) => void
  removeOpening: (id: string) => void

  // Objects
  addObject: (obj: Omit<PlacedObject, 'id'>) => PlacedObject
  updateObject: (id: string, updates: Partial<PlacedObject>) => void
  removeObject: (id: string) => void

  // Persistence
  hydrate: (plan: FloorPlan) => void
  getFloorPlan: () => FloorPlan
  markClean: () => void
  clearAll: () => void

  // Undo/redo
  pushHistory: () => void
  undo: () => void
  redo: () => void
}

const EMPTY_PLAN: FloorPlan = {
  walls: [],
  openings: [],
  objects: [],
  canvas_width: 1200,
  canvas_height: 800,
  grid_size: 20,
}

const floorName = (level: number) => {
  if (level === 0) return 'Ground Floor'
  if (level === 1) return 'First Floor'
  if (level === 2) return 'Second Floor'
  if (level === 3) return 'Third Floor'
  return `${level}th Floor`
}

const emptyFloor = (level: number): FloorLevel => ({
  id: uuidv4(),
  name: floorName(level),
  level,
  walls: [],
  openings: [],
  objects: [],
  canvas_width: 1200,
  canvas_height: 800,
  grid_size: 20,
})

const initialFloor = emptyFloor(0)

export const useFloorPlanStore = create<FloorPlanStore>((set, get) => ({
  walls: [],
  openings: [],
  objects: [],
  canvas_width: 1200,
  canvas_height: 800,
  grid_size: 20,
  floors: [initialFloor],
  activeFloorId: initialFloor.id,
  selectedId: null,
  activeTool: 'select',
  buildPreset: null,
  measurementUnit: 'm',
  wallMeasurementMode: 'outer',
  isDirty: false,
  history: [],
  historyIndex: -1,
  future: [],

  setTool: (t) => set({ activeTool: t, selectedId: null, buildPreset: null }),
  setBuildPreset: (preset) => set({ buildPreset: preset }),
  setSelected: (id) => set({ selectedId: id }),
  setGridSize: (size) => set({ grid_size: size, isDirty: true }),
  addFloor: () => {
    const s = get()
    const current: FloorLevel = {
      id: s.activeFloorId,
      name: s.floors.find(floor => floor.id === s.activeFloorId)?.name ?? 'Ground Floor',
      level: s.floors.find(floor => floor.id === s.activeFloorId)?.level ?? 0,
      walls: s.walls,
      openings: s.openings,
      objects: s.objects,
      canvas_width: s.canvas_width,
      canvas_height: s.canvas_height,
      grid_size: s.grid_size,
    }
    const nextLevel = s.floors.length === 0 ? 0 : Math.max(...s.floors.map(floor => floor.level)) + 1
    const next = emptyFloor(nextLevel)
    set({
      floors: [...s.floors.map(floor => floor.id === current.id ? current : floor), next],
      activeFloorId: next.id,
      walls: next.walls,
      openings: next.openings,
      objects: next.objects,
      canvas_width: next.canvas_width,
      canvas_height: next.canvas_height,
      grid_size: next.grid_size,
      selectedId: null,
      history: [],
      historyIndex: -1,
      future: [],
      isDirty: true,
    })
  },
  setActiveFloor: (id) => {
    const s = get()
    if (id === s.activeFloorId) return
    const target = s.floors.find(floor => floor.id === id)
    if (!target) return
    const floors = s.floors.map(floor => floor.id === s.activeFloorId
      ? {
        ...floor,
        walls: s.walls,
        openings: s.openings,
        objects: s.objects,
        canvas_width: s.canvas_width,
        canvas_height: s.canvas_height,
        grid_size: s.grid_size,
      }
      : floor)
    set({
      floors,
      activeFloorId: id,
      walls: target.walls,
      openings: target.openings,
      objects: target.objects,
      canvas_width: target.canvas_width,
      canvas_height: target.canvas_height,
      grid_size: target.grid_size,
      selectedId: null,
      history: [],
      historyIndex: -1,
      future: [],
      isDirty: true,
    })
  },
  toggleMeasurementUnit: () => set((s) => ({
    measurementUnit: s.measurementUnit === 'm' ? 'ft' : s.measurementUnit === 'ft' ? 'in' : 'm',
  })),
  toggleWallMeasurementMode: () => set((s) => ({
    wallMeasurementMode: s.wallMeasurementMode === 'outer'
      ? 'none'
      : s.wallMeasurementMode === 'none'
        ? 'all'
        : 'outer',
  })),

  pushHistory: () => {
    const s = get()
    const snap: FloorPlan = {
      walls: JSON.parse(JSON.stringify(s.walls)),
      openings: JSON.parse(JSON.stringify(s.openings)),
      objects: JSON.parse(JSON.stringify(s.objects)),
      canvas_width: s.canvas_width,
      canvas_height: s.canvas_height,
      grid_size: s.grid_size,
    }
    const history = s.history.slice(0, s.historyIndex + 1)
    history.push(snap)
    const limited = history.slice(-30)
    set({ history: limited, historyIndex: limited.length - 1, future: [] })
  },

  undo: () => {
    const { history, historyIndex, future } = get()
    if (historyIndex < 0) return
    const prev = history[historyIndex]
    const current = get().getFloorPlan()
    set({
      walls: prev.walls,
      openings: prev.openings,
      objects: prev.objects,
      canvas_width: prev.canvas_width,
      canvas_height: prev.canvas_height,
      grid_size: prev.grid_size,
      historyIndex: historyIndex - 1,
      future: [current, ...future].slice(0, 30),
      isDirty: true,
    })
  },

  redo: () => {
    const { future, history, historyIndex } = get()
    if (future.length === 0) return
    const next = future[0]
    set({
      walls: next.walls,
      openings: next.openings,
      objects: next.objects,
      canvas_width: next.canvas_width,
      canvas_height: next.canvas_height,
      grid_size: next.grid_size,
      historyIndex: Math.min(historyIndex + 1, history.length - 1),
      future: future.slice(1),
      isDirty: true,
    })
  },

  addWall: (wall) => {
    get().pushHistory()
    const newWall: Wall = { ...wall, id: uuidv4(), thickness: wall.thickness ?? 10, height: wall.height ?? 2.8 }
    set((s) => ({ walls: [...s.walls, newWall], isDirty: true }))
    return newWall
  },

  updateWall: (id, updates) => {
    set((s) => ({
      walls: s.walls.map((w) => (w.id === id ? { ...w, ...updates } : w)),
      isDirty: true,
    }))
  },

  removeWall: (id) => {
    get().pushHistory()
    set((s) => ({
      walls: s.walls.filter((w) => w.id !== id),
      openings: s.openings.filter((o) => o.wall_id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      isDirty: true,
    }))
  },

  addOpening: (opening) => {
    get().pushHistory()
    const newOpening: Opening = { ...opening, id: uuidv4() }
    set((s) => ({ openings: [...s.openings, newOpening], isDirty: true }))
  },

  removeOpening: (id) => {
    get().pushHistory()
    set((s) => ({
      openings: s.openings.filter((o) => o.id !== id),
      isDirty: true,
    }))
  },

  addObject: (obj) => {
    get().pushHistory()
    const newObj: PlacedObject = { ...obj, id: uuidv4() }
    set((s) => ({ objects: [...s.objects, newObj], isDirty: true }))
    return newObj
  },

  updateObject: (id, updates) => {
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, ...updates } : o)),
      isDirty: true,
    }))
  },

  removeObject: (id) => {
    get().pushHistory()
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      isDirty: true,
    }))
  },

  hydrate: (plan) => {
    const floors = plan.floors?.length
      ? plan.floors
      : [{
        id: uuidv4(),
        name: 'Ground Floor',
        level: 0,
        walls: plan.walls,
        openings: plan.openings,
        objects: plan.objects,
        canvas_width: plan.canvas_width,
        canvas_height: plan.canvas_height,
        grid_size: plan.grid_size,
      }]
    const active = floors.find(floor => floor.id === plan.active_floor_id) ?? floors[0]
    set({
      walls: active.walls,
      openings: active.openings,
      objects: active.objects,
      canvas_width: active.canvas_width,
      canvas_height: active.canvas_height,
      grid_size: active.grid_size,
      floors,
      activeFloorId: active.id,
      selectedId: null,
      isDirty: false,
      history: [],
      historyIndex: -1,
      future: [],
    })
  },

  getFloorPlan: () => {
    const s = get()
    const floors = s.floors.map(floor => floor.id === s.activeFloorId
      ? {
        ...floor,
        walls: s.walls,
        openings: s.openings,
        objects: s.objects,
        canvas_width: s.canvas_width,
        canvas_height: s.canvas_height,
        grid_size: s.grid_size,
      }
      : floor)
    return {
      walls: s.walls,
      openings: s.openings,
      objects: s.objects,
      canvas_width: s.canvas_width,
      canvas_height: s.canvas_height,
      grid_size: s.grid_size,
      floors,
      active_floor_id: s.activeFloorId,
    }
  },
  updateOpening: (id, updates) => {
    set((s) => ({
      openings: s.openings.map((o) =>
        o.id === id ? { ...o, ...updates } : o
      ),
      isDirty: true,
    }))
  },
  markClean: () => set({ isDirty: false }),

  clearAll: () => {
    get().pushHistory()
    set({ walls: [], openings: [], objects: [], selectedId: null, isDirty: true })
  },
}))
