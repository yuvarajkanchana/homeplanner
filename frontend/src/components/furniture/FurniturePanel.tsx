import { useState } from 'react'
import { useFloorPlanStore } from '../../store/useFloorPlanStore'
import { FURNITURE_PRESETS } from '../../types/schema'
import { Package } from 'lucide-react'

export function FurnitureSymbol({ type, color }: { type: string; color: string }) {
  const lineColor = 'rgba(255,255,255,0.62)'
  const detailColor = 'rgba(255,255,255,0.28)'
  const darkDetail = 'rgba(0,0,0,0.24)'

  if (type === 'sofa') {
    return (
      <div className="relative h-7 w-7 rounded bg-black/10">
        <div className="absolute left-1.5 right-1.5 top-2 h-3 rounded-sm" style={{ backgroundColor: color }} />
        <div className="absolute left-1 top-3 h-3 w-1.5 rounded-sm" style={{ backgroundColor: color }} />
        <div className="absolute right-1 top-3 h-3 w-1.5 rounded-sm" style={{ backgroundColor: color }} />
        <div className="absolute left-2.5 right-2.5 bottom-1.5 h-1 rounded" style={{ backgroundColor: darkDetail }} />
      </div>
    )
  }

  if (type === 'bed' || type === 'bed_s') {
    return (
      <div className="relative h-7 w-7 rounded bg-black/10">
        <div className="absolute inset-x-1 top-1 bottom-1 rounded-sm" style={{ backgroundColor: color }} />
        <div className="absolute left-2 top-2 h-2.5 w-2 rounded-sm bg-white/80" />
        {type === 'bed' && <div className="absolute right-2 top-2 h-2.5 w-2 rounded-sm bg-white/80" />}
        <div className="absolute left-2 right-2 top-[13px] h-px" style={{ backgroundColor: lineColor }} />
      </div>
    )
  }

  if (type === 'table') {
    return (
      <div className="relative h-7 w-7 rounded bg-black/10">
        <div className="absolute left-1.5 right-1.5 top-2 bottom-2 rounded-full border" style={{ backgroundColor: color, borderColor: lineColor }} />
        <div className="absolute left-[6px] top-[6px] h-1.5 w-1.5 rounded-full" style={{ backgroundColor: detailColor }} />
        <div className="absolute right-[6px] bottom-[6px] h-1.5 w-1.5 rounded-full" style={{ backgroundColor: detailColor }} />
      </div>
    )
  }

  if (type === 'desk') {
    return (
      <div className="relative h-7 w-7 rounded bg-black/10">
        <div className="absolute left-1 right-1 top-2 bottom-2 rounded-sm" style={{ backgroundColor: color }} />
        <div className="absolute left-2 right-2 top-3 h-px" style={{ backgroundColor: lineColor }} />
        <div className="absolute right-2 bottom-2 h-1.5 w-3 rounded-sm" style={{ backgroundColor: darkDetail }} />
      </div>
    )
  }

  if (type === 'chair') {
    return (
      <div className="relative h-7 w-7 rounded bg-black/10">
        <div className="absolute left-2 right-2 top-2 h-1.5 rounded-sm" style={{ backgroundColor: darkDetail }} />
        <div className="absolute left-2 right-2 top-3.5 bottom-2 rounded-sm" style={{ backgroundColor: color }} />
      </div>
    )
  }

  if (type === 'stairs') {
    return (
      <div className="relative h-7 w-7 rounded bg-black/10">
        <div className="absolute left-1.5 right-1.5 top-1 bottom-1 rounded-sm border border-white/45" style={{ backgroundColor: color }} />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-1 bottom-1 w-px bg-white/60"
            style={{ left: `${7 + i * 3}px` }}
          />
        ))}
        <div className="absolute left-1 right-1 top-1/2 h-px bg-indigo-300" />
      </div>
    )
  }

  if (type === 'wardrobe') {
    return (
      <div className="relative h-7 w-7 rounded bg-black/10">
        <div className="absolute left-1 right-1 top-2 bottom-2 rounded-sm" style={{ backgroundColor: color }} />
        <div className="absolute left-1/2 top-2 bottom-2 w-px bg-white/45" />
        <div className="absolute left-[10px] top-[13px] h-1 w-1 rounded-full bg-amber-100/80" />
        <div className="absolute right-[10px] top-[13px] h-1 w-1 rounded-full bg-amber-100/80" />
      </div>
    )
  }

  if (type === 'bath') {
    return (
      <div className="relative h-7 w-7 rounded bg-black/10">
        <div className="absolute left-2 right-2 top-1.5 bottom-1.5 rounded-full border" style={{ backgroundColor: color, borderColor: lineColor }} />
        <div className="absolute left-[11px] top-2.5 h-1.5 w-1.5 rounded-full bg-white/80" />
      </div>
    )
  }

  if (type === 'toilet') {
    return (
      <div className="relative h-7 w-7 rounded bg-black/10">
        <div className="absolute left-2 right-2 top-1.5 h-2 rounded-sm" style={{ backgroundColor: color }} />
        <div className="absolute left-[7px] right-[7px] bottom-2 h-3 rounded-full border" style={{ backgroundColor: '#eef8fc', borderColor: lineColor }} />
      </div>
    )
  }

  if (type === 'sink') {
    return (
      <div className="relative h-7 w-7 rounded bg-black/10">
        <div className="absolute left-1.5 right-1.5 top-2 bottom-2 rounded-sm" style={{ backgroundColor: color }} />
        <div className="absolute left-[8px] right-[8px] top-[9px] bottom-[9px] rounded-full bg-white/80" />
        <div className="absolute left-[13px] top-[13px] h-1 w-1 rounded-full bg-slate-500" />
      </div>
    )
  }

  return <div className="h-7 w-7 rounded-sm" style={{ backgroundColor: color }} />
}

export default function FurniturePanel() {
  const addObject = useFloorPlanStore((s) => s.addObject)
  const setTool = useFloorPlanStore((s) => s.setTool)
  const setSelected = useFloorPlanStore((s) => s.setSelected)
  const [filter, setFilter] = useState('')

  const filtered = FURNITURE_PRESETS.filter((p) =>
    p.label.toLowerCase().includes(filter.toLowerCase())
  )

  const handleClick = (preset: typeof FURNITURE_PRESETS[0]) => {
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
  }

  return (
    <div className="panel w-52 border-l border-border flex flex-col">
      <div className="px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300 mb-2">
          <Package size={13} /> Furniture
        </div>
        <input
          className="input-field text-xs py-1.5"
          placeholder="Search..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filtered.map((preset) => (
          <button
            key={preset.type}
            className="w-full text-left px-2.5 py-2 rounded hover:bg-white/5 transition-colors flex items-center gap-2.5 group cursor-pointer"
            onClick={() => handleClick(preset)}
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-white/10 bg-black/15">
              <FurnitureSymbol type={preset.type} color={preset.color} />
            </div>
            <div>
              <div className="text-xs text-gray-300 group-hover:text-white">{preset.label}</div>
              <div className="text-xs text-gray-600">{preset.width} x {preset.height}px</div>
            </div>
          </button>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-border">
        <p className="text-xs text-gray-600">Click to add - Drag to move - Del to remove</p>
      </div>
    </div>
  )
}
