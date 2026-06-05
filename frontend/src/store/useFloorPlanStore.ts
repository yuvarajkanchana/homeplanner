import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Wall, Opening, PlacedObject, FloorPlan, Tool } from '../types/schema'

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
  selectedId: string | null
  activeTool: Tool
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
  setSelected: (id: string | null) => void
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

export const useFloorPlanStore = create<FloorPlanStore>((set, get) => ({
  walls: [],
  openings: [],
  objects: [],
  canvas_width: 1200,
  canvas_height: 800,
  grid_size: 20,
  selectedId: null,
  activeTool: 'select',
  measurementUnit: 'm',
  wallMeasurementMode: 'outer',
  isDirty: false,
  history: [],
  historyIndex: -1,
  future: [],

  setTool: (t) => set({ activeTool: t, selectedId: null }),
  setSelected: (id) => set({ selectedId: id }),
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
    set({
      walls: plan.walls,
      openings: plan.openings,
      objects: plan.objects,
      canvas_width: plan.canvas_width,
      canvas_height: plan.canvas_height,
      grid_size: plan.grid_size,
      isDirty: false,
      history: [],
      historyIndex: -1,
      future: [],
    })
  },

  getFloorPlan: () => {
    const s = get()
    return {
      walls: s.walls,
      openings: s.openings,
      objects: s.objects,
      canvas_width: s.canvas_width,
      canvas_height: s.canvas_height,
      grid_size: s.grid_size,
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
