import { useState } from 'react'
import { useFloorPlanStore } from '../../store/useFloorPlanStore'
import { FURNITURE_PRESETS, type Tool } from '../../types/schema'
import { FurnitureSymbol } from '../furniture/FurniturePanel'
import {
  MousePointer2, Minus, DoorOpen, Square, Type,
  Hand, Undo2, Redo2, Grid3x3, Package, Rows4, Fence
} from 'lucide-react'

type ToolButton = { id: Tool; icon: React.ReactNode; label: string; shortcut?: string; onClick?: () => void }

const TOOLS: ToolButton[] = [
  { id: 'select',  icon: <MousePointer2 size={18} />, label: 'Select',   shortcut: 'V' },
  { id: 'pan',     icon: <Hand size={18} />,          label: 'Pan',      shortcut: 'Space' },
]

const BUILD_TOOLS: ToolButton[] = [
  { id: 'wall',    icon: <Minus size={18} />,         label: 'Wall',     shortcut: 'W' },
  { id: 'door',    icon: <DoorOpen size={18} />,      label: 'Door',     shortcut: 'D' },
  { id: 'stairs',  icon: <Rows4 size={18} />,         label: 'Stairs',   shortcut: 'S' },
  { id: 'gate',    icon: <Fence size={18} />,         label: 'Gate',     shortcut: 'G' },
  { id: 'window',  icon: <Square size={18} />,        label: 'Window',   shortcut: 'N' },
  { id: 'object',  icon: <Package size={18} />,       label: 'Furniture', shortcut: 'O' },
  { id: 'text',    icon: <Type size={18} />,          label: 'Text',     shortcut: 'T' },
]

const DOOR_SUB_TOOLS: ToolButton[] = [
  { id: 'door', icon: <DoorOpen size={16} />, label: 'Single Door', shortcut: 'D' },
  { id: 'doubleDoor', icon: <DoorOpen size={16} />, label: 'Double Door', shortcut: 'B' },
]

export default function Toolbar() {
  const { activeTool, setTool, undo, redo, clearAll, addObject, setSelected } = useFloorPlanStore()
  const [showFurniturePicker, setShowFurniturePicker] = useState(false)
  const [showDoorPicker, setShowDoorPicker] = useState(false)
  const [furnitureFilter, setFurnitureFilter] = useState('')

  const addFurniture = (preset: typeof FURNITURE_PRESETS[0]) => {
    const stairDefaults = preset.type === 'stairs'
      ? {
          stair_shape: 'straight' as const,
          stair_height: 2.8,
          stair_steps: 12,
        }
      : {}
    const obj = addObject({
      type: preset.type,
      label: preset.label,
      x: 300 + Math.random() * 200,
      y: 200 + Math.random() * 200,
      width: preset.width,
      height: preset.height,
      rotation: 0,
      color: preset.color,
      ...stairDefaults,
    })
    setTool('select')
    setSelected(obj.id)
    setShowFurniturePicker(false)
    setShowDoorPicker(false)
  }

  const filteredFurniture = FURNITURE_PRESETS.filter((preset) =>
    preset.label.toLowerCase().includes(furnitureFilter.toLowerCase())
  )

  const renderTool = (t: ToolButton, options?: { groupedActive?: boolean; className?: string }) => (
    <button
      key={t.id}
      className={`tool-btn group ${options?.className ?? ''} ${activeTool === t.id || options?.groupedActive || (t.id === 'object' && showFurniturePicker) ? 'active' : ''}`}
      onClick={() => {
        if (t.id === 'object') {
          setTool('object')
          setShowFurniturePicker((value) => !value)
          setShowDoorPicker(false)
          return
        }
        setShowFurniturePicker(false)
        setShowDoorPicker(false)
        setTool(t.id)
      }}
      title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ''}`}
    >
      <span className="tool-btn-icon">{t.icon}</span>
      <span className="tool-btn-label">{t.label}</span>
      <span className="tool-shortcut-chip">{t.shortcut}</span>
      <span className="tool-tooltip absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 border border-gray-700">
        {t.label}{t.shortcut && <span className="tool-tooltip-shortcut text-gray-400 ml-1">{t.shortcut}</span>}
      </span>
    </button>
  )

  return (
    <div className={`panel tool-sidebar ${showFurniturePicker ? 'furniture-open' : ''} ${showDoorPicker ? 'door-open' : ''} border-r border-border flex flex-col py-3 px-2 gap-1.5 select-none z-10`}>
      <div className="tool-section">
        <div className="tool-section-label">Navigate</div>
        {TOOLS.map((tool) => renderTool(tool))}
      </div>

      <div className="tool-section">
        <div className="tool-section-label">Build</div>
        {BUILD_TOOLS.map((tool) => {
          if (tool.id !== 'door') return renderTool(tool)

          return (
            <div key={tool.id} className={`tool-subgroup ${showDoorPicker ? 'open' : ''}`}>
              <button
                className={`tool-btn group ${activeTool === 'door' || activeTool === 'doubleDoor' || showDoorPicker ? 'active' : ''}`}
                onClick={() => {
                  setShowFurniturePicker(false)
                  setShowDoorPicker((value) => !value)
                }}
                title="Door"
              >
                <span className="tool-btn-icon">{tool.icon}</span>
                <span className="tool-btn-label">{tool.label}</span>
                <span className="tool-shortcut-chip">D</span>
                <span className="tool-tooltip absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 border border-gray-700">
                  Door
                </span>
              </button>
              <div className="tool-subitems" aria-label="Door types">
                {DOOR_SUB_TOOLS.map((subTool) => renderTool(subTool, { className: 'tool-btn-sub' }))}
              </div>
            </div>
          )
        })}
      </div>

      {showFurniturePicker && (
        <div className="toolbar-furniture-popover">
          <div className="toolbar-furniture-header">
            <Package size={14} />
            <span>Furniture</span>
          </div>
          <input
            className="toolbar-furniture-search"
            placeholder="Search..."
            value={furnitureFilter}
            onChange={(e) => setFurnitureFilter(e.target.value)}
          />
          <div className="toolbar-furniture-list">
            {filteredFurniture.map((preset) => (
              <button
                key={preset.type}
                className="toolbar-furniture-item"
                onClick={() => addFurniture(preset)}
              >
                <span className="toolbar-furniture-icon">
                  <FurnitureSymbol type={preset.type} color={preset.color} />
                </span>
                <span className="toolbar-furniture-copy">
                  <span>{preset.label}</span>
                  <small>{preset.width} x {preset.height}px</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tool-section mt-auto">
      <div className="tool-section-label">Actions</div>
      <button
        className="tool-btn group"
        onClick={undo}
        title="Undo (Ctrl+Z)"
      >
        <span className="tool-btn-icon"><Undo2 size={18} /></span>
        <span className="tool-btn-label">Undo</span>
        <span className="tool-shortcut-chip">Ctrl</span>
        <span className="tool-tooltip absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 border border-gray-700">
          Undo <span className="tool-tooltip-shortcut text-gray-400">Ctrl+Z</span>
        </span>
      </button>

      <button
        className="tool-btn group"
        onClick={redo}
        title="Redo (Ctrl+Y)"
      >
        <span className="tool-btn-icon"><Redo2 size={18} /></span>
        <span className="tool-btn-label">Redo</span>
        <span className="tool-shortcut-chip">Ctrl</span>
        <span className="tool-tooltip absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 border border-gray-700">
          Redo <span className="tool-tooltip-shortcut text-gray-400">Ctrl+Y</span>
        </span>
      </button>

      <button
        className="tool-btn group tool-btn-danger"
        onClick={() => { if (confirm('Clear all elements?')) clearAll() }}
        title="Clear all"
      >
        <span className="tool-btn-icon"><Grid3x3 size={18} /></span>
        <span className="tool-btn-label">Clear</span>
        <span className="tool-tooltip absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 border border-gray-700">
          Clear all
        </span>
      </button>
      </div>
    </div>
  )
}
