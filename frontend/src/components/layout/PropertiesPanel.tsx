import { useEffect, useState } from 'react'
import { useFloorPlanStore } from '../../store/useFloorPlanStore'
import { ChevronDown, ChevronUp, Settings, X } from 'lucide-react'
import type { Opening, PlacedObject } from '../../types/schema'
import type { MeasurementUnit } from '../../store/useFloorPlanStore'

type DoorStyle = NonNullable<Opening['door_style']>
type DoorMount = NonNullable<Opening['mount']>
type SwingDirection = NonNullable<Opening['swing_direction']>
type HandleStyle = NonNullable<Opening['handle_style']>
type WindowStyle = NonNullable<Opening['window_style']>
type StairShape = 'straight' | 'landing' | 'return_landing'
type LandingTurn = 'left' | 'right'

function formatLength(px: number, unit: MeasurementUnit) {
  const meters = px / 50
  if (unit === 'm') return `${meters.toFixed(2)} m`

  const feet = meters * 3.28084
  if (unit === 'in') {
    const totalInches = Math.round(feet * 12)
    const wholeFeet = Math.floor(totalInches / 12)
    const inches = totalInches % 12
    return `${wholeFeet}' ${inches}"`
  }

  return `${feet.toFixed(1)} ft`
}

function lengthInputLabel(unit: MeasurementUnit) {
  if (unit === 'm') return 'Length (m)'
  if (unit === 'ft') return 'Length (ft)'
  return `Length (' ")`
}

function pxToUnitValue(px: number, unit: MeasurementUnit) {
  const meters = px / 50
  if (unit === 'm') return Number(meters.toFixed(2))
  if (unit === 'ft') return Number((meters * 3.28084).toFixed(2))
  return Number((meters * 39.3701).toFixed(1))
}

function formatFeetInchesValue(px: number) {
  const totalInches = Math.max(1, Math.round((px / 50) * 39.3701))
  const feet = Math.floor(totalInches / 12)
  const inches = totalInches % 12
  return `${feet}' ${inches}"`
}

function parseFeetInchesToPx(value: string, fallbackPx: number) {
  const trimmed = value.trim()
  if (!trimmed) return fallbackPx

  const feetMatch = trimmed.match(/(-?\d+(?:\.\d+)?)\s*'/)
  const inchMatch = trimmed.match(/(-?\d+(?:\.\d+)?)\s*(?:"|in\b)/i)

  if (feetMatch || inchMatch) {
    const feet = feetMatch ? Number(feetMatch[1]) : 0
    const inches = inchMatch ? Number(inchMatch[1]) : 0
    const totalInches = feet * 12 + inches
    return totalInches > 0 ? (totalInches / 39.3701) * 50 : fallbackPx
  }

  const numericInches = Number(trimmed)
  if (!Number.isFinite(numericInches) || numericInches <= 0) return fallbackPx
  return (numericInches / 39.3701) * 50
}

function unitValueToPx(value: string, unit: MeasurementUnit, fallbackPx: number) {
  if (unit === 'in') return parseFeetInchesToPx(value, fallbackPx)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackPx
  if (unit === 'm') return parsed * 50
  if (unit === 'ft') return (parsed / 3.28084) * 50
  return fallbackPx
}

function clampNumber(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export default function PropertiesPanel() {
  const {
    selectedId,
    walls,
    openings,
    objects,
    updateWall,
    updateOpening,
    updateObject,
    removeWall,
    removeOpening,
    removeObject,
    pushHistory,
    measurementUnit,
  } = useFloorPlanStore()

  if (!selectedId) {
    return (
      <div className="panel w-52 border-l border-border flex flex-col">
        <div className="px-3 py-2.5 border-b border-border flex items-center gap-1.5 text-xs font-medium text-gray-300">
          <Settings size={13} /> Properties
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-gray-600 text-center">Select an element<br />to edit its properties</p>
        </div>
      </div>
    )
  }

  const wall = walls.find((w) => w.id === selectedId)
  const opening = openings.find((o) => o.id === selectedId)
  const obj = objects.find((o) => o.id === selectedId)
  const selectedWall = opening ? walls.find((w) => w.id === opening.wall_id) : null
  const title = wall ? 'Wall' : opening?.type === 'door' ? 'Door' : opening?.type === 'gate' ? 'Gate' : opening?.type === 'window' ? 'Window' : obj?.type === 'text' ? 'Text' : 'Object'

  return (
    <div className="panel w-52 border-l border-border flex flex-col">
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
          <Settings size={13} /> {title}
        </span>
        <button
          className="text-gray-500 hover:text-red-400 transition-colors"
          onClick={() => {
            if (wall) removeWall(selectedId)
            else if (opening) removeOpening(selectedId)
            else removeObject(selectedId)
          }}
          title="Delete (Del)"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {wall && (
          (() => {
            const wallLen = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
            const wallAngle = wallLen > 0
              ? Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x)
              : 0

            return (
          <>
            <PropRow label="Start X" value={Math.round(wall.start.x)} onFocus={pushHistory} onChange={(v) => updateWall(wall.id, { start: { ...wall.start, x: +v } })} />
            <PropRow label="Start Y" value={Math.round(wall.start.y)} onFocus={pushHistory} onChange={(v) => updateWall(wall.id, { start: { ...wall.start, y: +v } })} />
            <PropRow label="End X" value={Math.round(wall.end.x)} onFocus={pushHistory} onChange={(v) => updateWall(wall.id, { end: { ...wall.end, x: +v } })} />
            <PropRow label="End Y" value={Math.round(wall.end.y)} onFocus={pushHistory} onChange={(v) => updateWall(wall.id, { end: { ...wall.end, y: +v } })} />
            {measurementUnit === 'in' ? (
              <TextPropRow
                label={lengthInputLabel(measurementUnit)}
                value={formatFeetInchesValue(wallLen)}
                onFocus={pushHistory}
                onChange={(v) => {
                  const nextLen = unitValueToPx(v, measurementUnit, wallLen)
                  updateWall(wall.id, {
                    end: {
                      x: wall.start.x + Math.cos(wallAngle) * nextLen,
                      y: wall.start.y + Math.sin(wallAngle) * nextLen,
                    },
                  })
                }}
                onStep={(delta) => {
                  const nextLen = Math.max(1, wallLen + delta * (50 / 39.3701))
                  updateWall(wall.id, {
                    end: {
                      x: wall.start.x + Math.cos(wallAngle) * nextLen,
                      y: wall.start.y + Math.sin(wallAngle) * nextLen,
                    },
                  })
                }}
              />
            ) : (
              <PropRow
                label={lengthInputLabel(measurementUnit)}
                value={pxToUnitValue(wallLen, measurementUnit)}
                onFocus={pushHistory}
                onChange={(v) => {
                  const nextLen = unitValueToPx(v, measurementUnit, wallLen)
                  updateWall(wall.id, {
                    end: {
                      x: wall.start.x + Math.cos(wallAngle) * nextLen,
                      y: wall.start.y + Math.sin(wallAngle) * nextLen,
                    },
                  })
                }}
                min={measurementUnit === 'm' ? 0.1 : 1}
                step={0.1}
              />
            )}
            <PropRow label="Thickness" value={wall.thickness} onFocus={pushHistory} onChange={(v) => updateWall(wall.id, { thickness: +v })} min={5} max={40} />
            <PropRow
              label="Height (m)"
              value={wall.height ?? 2.8}
              onFocus={pushHistory}
              onChange={(v) => updateWall(wall.id, { height: clampNumber(v, wall.height ?? 2.8, 1, 5) })}
              step={0.1}
              min={1}
              max={5}
            />
            <ColorRow
              label="3D wall color"
              value={wall.color ?? '#ffffff'}
              onFocus={pushHistory}
              onChange={(v) => updateWall(wall.id, { color: v })}
            />
            <button
              type="button"
              className="w-full rounded border border-border bg-gray-800 px-2 py-1.5 text-xs font-medium text-gray-100 transition-colors hover:bg-gray-700"
              onClick={() => {
                const color = wall.color ?? '#ffffff'
                pushHistory()
                walls.forEach((item) => updateWall(item.id, { color }))
              }}
            >
              Apply to all walls
            </button>
            <div className="pt-1">
              <div className="text-xs text-gray-500">
                Length: {formatLength(wallLen, measurementUnit)}
              </div>
            </div>
          </>
            )
          })()
        )}

        {opening && (
          <>
            <PropRow
              label="Width"
              value={opening.width}
              onFocus={pushHistory}
              onChange={(v) => updateOpening(opening.id, {
                width: +v,
                ...(opening.type === 'door'
                  ? {
                    door_style: (opening.door_style ?? 'hinged') === 'hinged' && +v >= 80
                      ? 'double'
                      : (opening.door_style ?? 'hinged'),
                  }
                  : {}),
              })}
              min={20}
              max={selectedWall ? Math.max(20, Math.hypot(selectedWall.end.x - selectedWall.start.x, selectedWall.end.y - selectedWall.start.y)) : 500}
            />
            <PropRow
              label="Position (%)"
              value={Math.round(opening.offset * 100)}
              onFocus={pushHistory}
              onChange={(v) => updateOpening(opening.id, { offset: Math.max(5, Math.min(95, +v)) / 100 })}
              min={5}
              max={95}
            />

            {(opening.type === 'door' || opening.type === 'gate') && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Door style</label>
                  <select
                    className="input-field text-xs py-1"
                    value={opening.door_style ?? 'hinged'}
                    onFocus={pushHistory}
                    onChange={(e) => updateOpening(opening.id, { door_style: e.target.value as DoorStyle })}
                  >
                    <option value="hinged">Hinged</option>
                    <option value="double">Double</option>
                    <option value="sliding">Sliding</option>
                    <option value="pocket">Pocket</option>
                    <option value="bifold">Bifold</option>
                    <option value="garage">Garage</option>
                    <option value="fixed">Fixed</option>
                    <option value="barn">Barn</option>
                    <option value="shower">Shower</option>
                    <option value="opening">Opening only</option>
                  </select>
                </div>
                <PropRow
                  label="Height (m)"
                  value={opening.height ?? 2.1}
                  onFocus={pushHistory}
                  onChange={(v) => updateOpening(opening.id, { height: +v })}
                  min={1.6}
                  max={3}
                  step={0.1}
                />
                <PropRow
                  label="Elevation (m)"
                  value={opening.elevation ?? 0}
                  onFocus={pushHistory}
                  onChange={(v) => updateOpening(opening.id, { elevation: +v })}
                  min={0}
                  max={1}
                  step={0.05}
                />
                <PropRow
                  label="Trim (m)"
                  value={opening.trim ?? 0.08}
                  onFocus={pushHistory}
                  onChange={(v) => updateOpening(opening.id, { trim: +v })}
                  min={0}
                  max={0.3}
                  step={0.01}
                />
                <PropRow
                  label="Swing angle"
                  value={opening.swing_angle ?? 90}
                  onFocus={pushHistory}
                  onChange={(v) => updateOpening(opening.id, { swing_angle: +v })}
                  min={15}
                  max={180}
                  step={5}
                />
                <PropRow
                  label="Rotation (deg)"
                  value={opening.rotation ?? (selectedWall ? Math.round(Math.atan2(selectedWall.end.y - selectedWall.start.y, selectedWall.end.x - selectedWall.start.x) * 180 / Math.PI) : 0)}
                  onFocus={pushHistory}
                  onChange={(v) => updateOpening(opening.id, { rotation: +v })}
                  min={-180}
                  max={180}
                  step={5}
                />
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Mount</label>
                  <select
                    className="input-field text-xs py-1"
                    value={opening.mount ?? 'center'}
                    onFocus={pushHistory}
                    onChange={(e) => updateOpening(opening.id, { mount: e.target.value as DoorMount })}
                  >
                    <option value="center">Center</option>
                    <option value="interior">Interior flush</option>
                    <option value="exterior">Exterior flush</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Swing side</label>
                  <select
                    className="input-field text-xs py-1"
                    value={opening.swing}
                    onFocus={pushHistory}
                    onChange={(e) => updateOpening(opening.id, { swing: e.target.value as 'left' | 'right' })}
                  >
                    <option value="left">Left hinge</option>
                    <option value="right">Right hinge</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Swing direction</label>
                  <select
                    className="input-field text-xs py-1"
                    value={opening.swing_direction ?? 'in'}
                    onFocus={pushHistory}
                    onChange={(e) => updateOpening(opening.id, { swing_direction: e.target.value as SwingDirection })}
                  >
                    <option value="in">Inward</option>
                    <option value="out">Outward</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Hardware</label>
                  <select
                    className="input-field text-xs py-1"
                    value={opening.handle_style ?? 'knob'}
                    onFocus={pushHistory}
                    onChange={(e) => updateOpening(opening.id, { handle_style: e.target.value as HandleStyle })}
                  >
                    <option value="knob">Knob</option>
                    <option value="lever">Lever</option>
                    <option value="bar">Bar pull</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <ColorRow
                  label="Frame color"
                  value={opening.frame_color ?? '#111827'}
                  onFocus={pushHistory}
                  onChange={(v) => updateOpening(opening.id, { frame_color: v })}
                />
                <ColorRow
                  label="Panel color"
                  value={opening.panel_color ?? '#ffffff'}
                  onFocus={pushHistory}
                  onChange={(v) => updateOpening(opening.id, { panel_color: v })}
                />
              </>
            )}

            {opening.type === 'window' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Window style</label>
                <select
                  className="input-field text-xs py-1"
                  value={opening.window_style ?? 'double_hung'}
                  onFocus={pushHistory}
                  onChange={(e) => updateOpening(opening.id, { window_style: e.target.value as WindowStyle })}
                >
                  <option value="awning">Awning</option>
                  <option value="bay">Bay</option>
                  <option value="bow">Bow</option>
                  <option value="casement">Casement</option>
                  <option value="cottage">Cottage</option>
                  <option value="center_pivot">Center pivot</option>
                  <option value="dormer">Dormer</option>
                  <option value="double_hung">Double-hung</option>
                  <option value="egress">Egress</option>
                  <option value="fixed">Fixed</option>
                  <option value="french">French door</option>
                  <option value="garden">Garden</option>
                  <option value="hopper">Hopper</option>
                  <option value="glass_block">Glass block</option>
                  <option value="jalousie">Jalousie</option>
                  <option value="lunette">Lunette</option>
                  <option value="oriel">Oriel</option>
                  <option value="palladian">Palladian</option>
                  <option value="picture">Picture</option>
                  <option value="radius">Radius</option>
                  <option value="round">Round</option>
                  <option value="single_hung">Single-hung</option>
                  <option value="skylight">Skylight</option>
                  <option value="storm">Storm</option>
                  <option value="three_panel_slider">Three-panel slider</option>
                  <option value="tilt_turn">Tilt and turn</option>
                  <option value="transom">Transom</option>
                  <option value="two_panel_slider">Two-panel slider</option>
                </select>
              </div>
            )}
          </>
        )}

        {obj && (
          <>
            <PropRow label="X" value={Math.round(obj.x)} onFocus={pushHistory} onChange={(v) => updateObject(obj.id, { x: +v })} />
            <PropRow label="Y" value={Math.round(obj.y)} onFocus={pushHistory} onChange={(v) => updateObject(obj.id, { y: +v })} />
            <PropRow label="Width" value={obj.width} onFocus={pushHistory} onChange={(v) => updateObject(obj.id, { width: +v })} min={20} max={500} />
            <PropRow label={obj.type === 'text' ? 'Height' : 'Depth'} value={obj.height} onFocus={pushHistory} onChange={(v) => updateObject(obj.id, { height: +v })} min={20} max={500} />
            <PropRow label="Rotation (deg)" value={obj.rotation} onFocus={pushHistory} onChange={(v) => updateObject(obj.id, { rotation: +v })} min={0} max={360} />
            {obj.type === 'stairs' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Stair type</label>
                  <select
                    className="input-field text-xs py-1"
                    value={obj.stair_shape ?? 'straight'}
                    onFocus={pushHistory}
                    onChange={(e) => updateObject(obj.id, { stair_shape: e.target.value as StairShape })}
                  >
                    <option value="straight">Regular</option>
                    <option value="landing">With landing</option>
                    <option value="return_landing">Opposite landing</option>
                  </select>
                </div>
                <PropRow
                  label="Stair height (m)"
                  value={obj.stair_height ?? 2.8}
                  onFocus={pushHistory}
                  onChange={(v) => updateObject(obj.id, { stair_height: clampNumber(v, obj.stair_height ?? 2.8, 0.5, 6) })}
                  min={0.5}
                  max={6}
                  step={0.1}
                />
                <PropRow
                  label="Steps"
                  value={obj.stair_steps ?? 12}
                  onFocus={pushHistory}
                  onChange={(v) => updateObject(obj.id, { stair_steps: clampNumber(v, obj.stair_steps ?? 12, 3, 30) })}
                  min={3}
                  max={30}
                  step={1}
                />
                {(obj.stair_shape === 'landing' || obj.stair_shape === 'return_landing') && (
                  <>
                    {obj.stair_shape === 'landing' ? (
                      <PropRow
                        label="Landing width"
                        value={obj.landing_width ?? 80}
                        onFocus={pushHistory}
                        onChange={(v) => updateObject(obj.id, { landing_width: clampNumber(v, obj.landing_width ?? 80, 30, 240) })}
                        min={30}
                        max={240}
                      />
                    ) : (() => {
                      const legacyLandingWidth = Math.min(obj.width * 0.34, Math.max(34, obj.landing_width ?? 80))
                      const currentLandingWidth = obj.landing_width ?? obj.landingWidth ?? legacyLandingWidth
                      const legacyRunWidth = Math.max(12, obj.width - currentLandingWidth)
                      const leftRunWidth = obj.left_run_width ?? obj.leftRunWidth ?? legacyRunWidth
                      const rightRunWidth = obj.right_run_width ?? obj.rightRunWidth ?? legacyRunWidth
                      const updateReturnDimensions = (updates: Partial<PlacedObject>) => {
                        const nextLandingWidth = updates.landing_width ?? currentLandingWidth
                        const nextLeftRunWidth = updates.left_run_width ?? leftRunWidth
                        const nextRightRunWidth = updates.right_run_width ?? rightRunWidth
                        updateObject(obj.id, {
                          ...updates,
                          width: nextLandingWidth + Math.max(nextLeftRunWidth, nextRightRunWidth),
                        })
                      }

                      return (
                        <>
                          <PropRow
                            label="Left run width"
                            value={leftRunWidth}
                            onFocus={pushHistory}
                            onChange={(v) => updateReturnDimensions({
                              left_run_width: clampNumber(v, leftRunWidth, 12, 500),
                            })}
                            min={12}
                            max={500}
                          />
                          <PropRow
                            label="Right run width"
                            value={rightRunWidth}
                            onFocus={pushHistory}
                            onChange={(v) => updateReturnDimensions({
                              right_run_width: clampNumber(v, rightRunWidth, 12, 500),
                            })}
                            min={12}
                            max={500}
                          />
                          <PropRow
                            label="Landing width"
                            value={currentLandingWidth}
                            onFocus={pushHistory}
                            onChange={(v) => updateReturnDimensions({
                              landing_width: clampNumber(v, currentLandingWidth, 30, 240),
                            })}
                            min={30}
                            max={240}
                          />
                        </>
                      )
                    })()}
                    <PropRow
                      label="Landing depth"
                      value={obj.landing_depth ?? 80}
                      onFocus={pushHistory}
                      onChange={(v) => updateObject(obj.id, { landing_depth: clampNumber(v, obj.landing_depth ?? 80, 30, 240) })}
                      min={30}
                      max={240}
                    />
                    {(obj.stair_shape === 'landing' || obj.stair_shape === 'return_landing') && (
                      <>
                        <PropRow
                          label="Middle length"
                          value={obj.stair_shape === 'landing'
                            ? Math.max(28, (obj.height - Math.min(obj.height * 0.58, Math.max(34, obj.landing_depth ?? 80))) / 2)
                            : Math.max(10, obj.height - Math.max(22, obj.landing_depth ?? 80) * 2)}
                          onFocus={pushHistory}
                          onChange={(v) => {
                            if (obj.stair_shape === 'landing') {
                              const middleLength = clampNumber(v, Math.max(28, (obj.height - Math.min(obj.height * 0.58, Math.max(34, obj.landing_depth ?? 80))) / 2), 28, 500)
                              const landingDepth = Math.min(obj.height * 0.58, Math.max(34, obj.landing_depth ?? 80))
                              updateObject(obj.id, { height: landingDepth + middleLength * 2 })
                              return
                            }

                            const runHeight = Math.max(22, obj.landing_depth ?? 80)
                            const middleLength = clampNumber(v, Math.max(10, obj.height - runHeight * 2), 10, 500)
                            updateObject(obj.id, { height: runHeight * 2 + middleLength })
                          }}
                          min={obj.stair_shape === 'landing' ? 28 : 10}
                          max={500}
                        />
                        {(obj.stair_shape === 'landing' || obj.stair_shape === 'return_landing') && (
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Turn direction</label>
                            <select
                              className="input-field text-xs py-1"
                              value={obj.landing_turn ?? 'left'}
                              onFocus={pushHistory}
                              onChange={(e) => updateObject(obj.id, { landing_turn: e.target.value as LandingTurn })}
                            >
                              <option value="left">Left</option>
                              <option value="right">Right</option>
                            </select>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Color</label>
              <ColorInput value={obj.color} onFocus={pushHistory} onChange={(v) => updateObject(obj.id, { color: v })} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Label</label>
              <input
                className="input-field text-xs"
                value={obj.label}
                onFocus={pushHistory}
                onChange={(e) => updateObject(obj.id, { label: e.target.value })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ColorRow({
  label, value, onChange, onFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onFocus?: () => void
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <ColorInput value={value} onChange={onChange} onFocus={onFocus} />
    </div>
  )
}

function ColorInput({
  value, onChange, onFocus,
}: {
  value: string
  onChange: (v: string) => void
  onFocus?: () => void
}) {
  return (
    <input
      type="color"
      value={value}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 rounded cursor-pointer bg-transparent border border-border"
    />
  )
}

function PropRow({
  label, value, onChange, onFocus, min, max, step,
}: {
  label: string
  value: number
  onChange: (v: string) => void
  onFocus?: () => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type="number"
        className="input-field text-xs py-1"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function TextPropRow({
  label, value, onChange, onFocus, onStep,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onFocus?: () => void
  onStep?: (delta: number) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <div className="flex h-[34px] overflow-hidden rounded border border-border bg-white">
        <input
          type="text"
          className="min-w-0 flex-1 border-0 bg-white px-2 text-xs outline-none !text-black"
          value={draft}
          onFocus={onFocus}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onChange(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          placeholder={`0' 0"`}
        />
        {onStep && (
          <div className="flex w-7 flex-col bg-white">
            <button
              type="button"
              className="flex flex-1 w-full items-center justify-center text-gray-500 hover:bg-gray-100"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onStep(1)}
              title="Increase by 1 inch"
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              className="flex flex-1 w-full items-center justify-center text-gray-500 hover:bg-gray-100"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onStep(-1)}
              title="Decrease by 1 inch"
            >
              <ChevronDown size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
