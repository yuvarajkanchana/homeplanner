import { useRef, useState, useEffect, type CSSProperties } from 'react'
import Konva from 'konva'
import { Stage, Layer, Line, Rect, Circle, Group, Text, Arc, Arrow } from 'react-konva'
import { useFloorPlanStore } from '../../store/useFloorPlanStore'
import type { MeasurementUnit, WallMeasurementMode } from '../../store/useFloorPlanStore'
import type { Point, Wall, Opening, PlacedObject, Tool } from '../../types/schema'

const SNAP_GRID = 20
const SNAP_ENDPOINT_DIST = 25
const SNAP_WALL_DIST = 18
const PX_PER_METER = 50
const WALL_COLOR = '#c8cdd8'
const WALL_SELECTED = '#4f6ef7'
const DOOR_COLOR = '#f59e0b'
const WINDOW_COLOR = '#000000'

// ─── Math helpers ─────────────────────────────────────────────────────────────

function snapTo(v: number, g: number) { return Math.round(v / g) * g }

function getTextboxFontSize(width: number, height: number) {
  return Math.max(7, Math.min(22, height * 0.32, width * 0.12))
}

function RotateHandleIcon({ x, y, rotation = 0 }: { x: number; y: number; rotation?: number }) {
  return (
    <Group x={x} y={y} rotation={rotation} listening={false}>
      <Arc
        innerRadius={3.3}
        outerRadius={5.8}
        angle={275}
        rotation={-42}
        fill="#ffffff"
      />
      <Line
        points={[2.8, -6.2, 7.1, -5.2, 5.1, -1.2]}
        closed
        fill="#ffffff"
        stroke="#ffffff"
        strokeWidth={0.6}
        lineJoin="round"
      />
    </Group>
  )
}

/**
 * Snap to the nearest wall endpoint within SNAP_ENDPOINT_DIST,
 * otherwise fall back to grid snap.
 */
function snapToEndpoints(x: number, y: number, walls: Wall[]): { x: number; y: number } {
  let best = { x: snapTo(x, SNAP_GRID), y: snapTo(y, SNAP_GRID) }
  let minDist = SNAP_ENDPOINT_DIST

  for (const w of walls) {
    for (const p of [w.start, w.end]) {
      const d = Math.hypot(x - p.x, y - p.y)
      if (d < minDist) {
        best = { x: p.x, y: p.y }
        minDist = d
      }
    }
  }

  return best
}

function snapToWallGeometry(x: number, y: number, walls: Wall[]): { x: number; y: number } {
  const endpoint = snapToEndpoints(x, y, walls)
  if (Math.hypot(x - endpoint.x, y - endpoint.y) < SNAP_ENDPOINT_DIST) return endpoint

  const wallPoint = closestPointOnWalls(x, y, walls)
  if (wallPoint && Math.hypot(x - wallPoint.x, y - wallPoint.y) < SNAP_WALL_DIST) {
    return {
      x: snapTo(wallPoint.x, SNAP_GRID),
      y: snapTo(wallPoint.y, SNAP_GRID),
    }
  }

  return endpoint
}

function snapDraggedEndpoint(
  x: number,
  y: number,
  walls: Wall[],
  movingEndpoints: ConnectedWallEndpoint[]
): { x: number; y: number } {
  const moving = new Set(movingEndpoints.map(({ wallId, endpoint }) => `${wallId}:${endpoint}`))
  let best = { x: snapTo(x, SNAP_GRID), y: snapTo(y, SNAP_GRID) }
  let minDist = SNAP_ENDPOINT_DIST

  for (const w of walls) {
    for (const [endpoint, p] of [
      ['start', w.start],
      ['end', w.end],
    ] as const) {
      if (moving.has(`${w.id}:${endpoint}`)) continue
      const d = Math.hypot(x - p.x, y - p.y)
      if (d < minDist) {
        best = { x: p.x, y: p.y }
        minDist = d
      }
    }
  }

  return best
}

/**
 * After committing a wall end-point, force it to exactly match any nearby
 * existing point so walls share the same coordinate reference.
 */
function mergeWithExistingPoints(
  point: { x: number; y: number },
  walls: Wall[],
  threshold = SNAP_ENDPOINT_DIST
): { x: number; y: number } {
  for (const w of walls) {
    if (Math.hypot(point.x - w.start.x, point.y - w.start.y) < threshold) return w.start
    if (Math.hypot(point.x - w.end.x, point.y - w.end.y) < threshold) return w.end
  }

  const wallPoint = closestPointOnWalls(point.x, point.y, walls)
  if (wallPoint && Math.hypot(point.x - wallPoint.x, point.y - wallPoint.y) < SNAP_WALL_DIST) {
    return {
      x: snapTo(wallPoint.x, SNAP_GRID),
      y: snapTo(wallPoint.y, SNAP_GRID),
    }
  }

  return point
}

function closestPointOnWalls(px: number, py: number, walls: Wall[]) {
  let best: { x: number; y: number } | null = null
  let minDist = 15

  for (const w of walls) {
    const dx = w.end.x - w.start.x
    const dy = w.end.y - w.start.y
    const t = ((px - w.start.x) * dx + (py - w.start.y) * dy) / (dx * dx + dy * dy)
    const clamped = Math.max(0, Math.min(1, t))
    const cx = w.start.x + clamped * dx
    const cy = w.start.y + clamped * dy
    const dist = Math.hypot(px - cx, py - cy)
    if (dist < minDist) { best = { x: cx, y: cy }; minDist = dist }
  }

  return best
}

function wallLength(w: Wall) {
  return Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y)
}

function formatLength(px: number, unit: MeasurementUnit) {
  const meters = px / PX_PER_METER
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

function wallAngle(w: Wall) {
  return Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x)
}

function projectOntoWall(px: number, py: number, w: Wall) {
  const dx = w.end.x - w.start.x
  const dy = w.end.y - w.start.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return null
  const t = ((px - w.start.x) * dx + (py - w.start.y) * dy) / len2
  const clamped = Math.max(0.05, Math.min(0.95, t))
  const cx = w.start.x + clamped * dx
  const cy = w.start.y + clamped * dy
  const dist = Math.hypot(px - cx, py - cy)
  return { offset: clamped, dist, cx, cy }
}

function pointerWorldPosition(stage: Konva.Stage) {
  const ptr = stage.getPointerPosition()
  if (!ptr) return null
  const scale = stage.scaleX() || 1
  return {
    x: (ptr.x - stage.x()) / scale,
    y: (ptr.y - stage.y()) / scale,
  }
}

function stopKonvaBubble(e: Konva.KonvaEventObject<MouseEvent | TouchEvent | DragEvent>) {
  e.cancelBubble = true
}

function openingWorldPos(w: Wall, o: Opening) {
  return {
    x: w.start.x + (w.end.x - w.start.x) * o.offset,
    y: w.start.y + (w.end.y - w.start.y) * o.offset,
  }
}

// ─── Door 2D shape ────────────────────────────────────────────────────────────

function DoorShape({ wall, opening, selected, onSelect, onDelete, onChange }: {
  wall: Wall; opening: Opening; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onChange:(u:Partial<Opening>) => void
}) {
  const pushHistory = useFloorPlanStore(s => s.pushHistory)
  const angle = opening.rotation ?? (wallAngle(wall) * 180 / Math.PI)
  const angleRad = angle * Math.PI / 180
  const pos = openingWorldPos(wall, opening)
  const w = opening.width
  const swing = opening.swing === 'left' ? 1 : -1
  const swingDirection = opening.swing_direction === 'out' ? -1 : 1
  const swingAngle = opening.swing_angle ?? 90
  const doorStyle = opening.door_style ?? 'hinged'
  const frameColor = selected ? '#fbbf24' : opening.frame_color ?? '#111827'
  const panelColor = opening.panel_color ?? 'rgba(255,255,255,0.72)'

  const hingeOffX = Math.cos(angleRad) * (w / 2) * -1
  const hingeOffY = Math.sin(angleRad) * (w / 2) * -1
  const hx = pos.x + hingeOffX
  const hy = pos.y + hingeOffY
  const arcAngle = swingAngle * swing * swingDirection
  const rotateHandleDistance = w / 2 + 32
  const rotateHandleAngle = angleRad - Math.PI / 2
  const rotateHandleX = pos.x + Math.cos(rotateHandleAngle) * rotateHandleDistance
  const rotateHandleY = pos.y + Math.sin(rotateHandleAngle) * rotateHandleDistance
  const dragAlongWall = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true
    const stage = e.target.getStage()
    if (!stage) return
    const world = pointerWorldPosition(stage)
    if (!world) return
    const projected = projectOntoWall(world.x, world.y, wall)
    if (!projected) return
    onChange({ offset: projected.offset })
    e.target.x(0)
    e.target.y(0)
  }
  const resetDragPosition = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true
    e.target.x(0)
    e.target.y(0)
  }

  if (opening.type === 'gate') {
    const gateHeight = Math.max(34, Math.min(58, w * 0.38))
    const barCount = Math.max(8, Math.round(w / 10))
    const gateStroke = selected ? '#fbbf24' : frameColor
    const dragGateAlongWall = (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true
      const stage = e.target.getStage()
      if (!stage) return
      const world = pointerWorldPosition(stage)
      if (!world) return
      const projected = projectOntoWall(world.x, world.y, wall)
      if (projected) onChange({ offset: projected.offset })
      e.target.x(pos.x)
      e.target.y(pos.y)
    }
    const resetGateDragPosition = (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true
      e.target.x(pos.x)
      e.target.y(pos.y)
    }

    return (
      <Group
        x={pos.x}
        y={pos.y}
        rotation={angle}
        onClick={onSelect}
        onTap={onSelect}
        draggable={selected}
        onDragStart={pushHistory}
        onDragMove={dragGateAlongWall}
        onDragEnd={resetGateDragPosition}
      >
        <Rect
          x={-w / 2}
          y={-gateHeight / 2}
          width={w}
          height={gateHeight}
          fill="rgba(255,255,255,0.7)"
          stroke={gateStroke}
          strokeWidth={selected ? 2.5 : 1.6}
          cornerRadius={2}
        />
        <Line points={[0, -gateHeight / 2, 0, gateHeight / 2]} stroke={gateStroke} strokeWidth={1.4} />
        {Array.from({ length: barCount + 1 }).map((_, i) => {
          const x = -w / 2 + (w / barCount) * i
          const topCurve = -gateHeight / 2 + 4 + Math.abs(x / (w / 2)) * 8
          return <Line key={i} points={[x, topCurve, x, gateHeight / 2 - 4]} stroke={gateStroke} strokeWidth={1} opacity={0.9} />
        })}
        <Line
          points={[-w / 2 + 4, -gateHeight / 2 + 12, -w / 4, -gateHeight / 2 + 4, 0, -gateHeight / 2 + 10, w / 4, -gateHeight / 2 + 4, w / 2 - 4, -gateHeight / 2 + 12]}
          stroke={gateStroke}
          strokeWidth={1.2}
          tension={0.45}
        />
        {[-w * 0.24, w * 0.24].map((x) => (
          <Group key={x} x={x}>
            <Circle radius={5} stroke={gateStroke} strokeWidth={1.1} />
            <Line points={[-8, 0, 8, 0]} stroke={gateStroke} strokeWidth={1} />
            <Line points={[0, -8, 0, 8]} stroke={gateStroke} strokeWidth={1} />
          </Group>
        ))}
        {[-w * 0.06, w * 0.06].map((x) => (
          <Circle key={x} x={x} radius={2.2} fill={gateStroke} />
        ))}
        <Circle radius={Math.max(w / 2, gateHeight / 2) + 8} fill="transparent" onClick={(e) => { stopKonvaBubble(e); onSelect() }} />
        {selected && (
          <>
            <Group x={0} y={-gateHeight / 2 - 16} onMouseDown={stopKonvaBubble} onClick={(e) => { stopKonvaBubble(e); onDelete() }}>
              <Circle radius={8} fill="#ef4444" />
              <Text text="×" fontSize={13} fill="white" offsetX={4} offsetY={6} />
            </Group>
            <Circle
              x={w / 2}
              y={0}
              radius={6}
              fill="#4f6ef7"
              stroke="#fff"
              strokeWidth={1}
              draggable
              onMouseDown={stopKonvaBubble}
              onDragStart={(e) => { stopKonvaBubble(e); pushHistory() }}
              onDragMove={(e) => {
                stopKonvaBubble(e)
                const stage = e.target.getStage()
                if (!stage) return
                const world = pointerWorldPosition(stage)
                if (!world) return
                const dx = world.x - pos.x
                const dy = world.y - pos.y
                const proj = dx * Math.cos(angleRad) + dy * Math.sin(angleRad)
                const maxWidth = Math.max(40, wallLength(wall) * 0.9)
                const newWidth = Math.min(maxWidth, Math.max(40, Math.abs(proj) * 2))
                onChange({ width: newWidth })
                e.target.x(newWidth / 2)
                e.target.y(0)
              }}
              onDragEnd={(e) => {
                stopKonvaBubble(e)
                e.target.x(opening.width / 2)
                e.target.y(0)
              }}
            />
          </>
        )}
      </Group>
    )
  }

  if (doorStyle === 'opening') {
    return (
      <Group onClick={onSelect} onTap={onSelect} draggable={selected} onDragStart={pushHistory} onDragMove={dragAlongWall} onDragEnd={resetDragPosition}>
        <Line
          points={[
            pos.x - Math.cos(angleRad) * w / 2,
            pos.y - Math.sin(angleRad) * w / 2,
            pos.x + Math.cos(angleRad) * w / 2,
            pos.y + Math.sin(angleRad) * w / 2,
          ]}
          stroke={frameColor}
          strokeWidth={selected ? 3 : 2}
          dash={[7, 4]}
          lineCap="round"
        />
        <Circle x={pos.x} y={pos.y} radius={opening.width / 2 + 6} fill="transparent" onClick={(e) => { stopKonvaBubble(e); onSelect() }} />
      </Group>
    )
  }

  if (doorStyle === 'sliding' || doorStyle === 'pocket' || doorStyle === 'barn') {
    const perp = angleRad + Math.PI / 2
    const panelOffset = (wall.thickness + 8) / 2
    const ax = Math.cos(angleRad) * w / 2
    const ay = Math.sin(angleRad) * w / 2
    const px = Math.cos(perp) * panelOffset
    const py = Math.sin(perp) * panelOffset
    return (
      <Group onClick={onSelect} onTap={onSelect} draggable={selected} onDragStart={pushHistory} onDragMove={dragAlongWall} onDragEnd={resetDragPosition}>
        <Line points={[pos.x - ax, pos.y - ay, pos.x + ax, pos.y + ay]} stroke={frameColor} strokeWidth={selected ? 3 : 2} />
        <Line points={[pos.x - ax + px, pos.y - ay + py, pos.x + px, pos.y + py]} stroke={opening.panel_color ?? '#ffffff'} strokeWidth={4} lineCap="round" />
        <Line points={[pos.x - px, pos.y - py, pos.x + ax - px, pos.y + ay - py]} stroke={opening.panel_color ?? '#ffffff'} strokeWidth={4} lineCap="round" />
        <Circle x={pos.x} y={pos.y} radius={opening.width / 2 + 6} fill="transparent" onClick={(e) => { stopKonvaBubble(e); onSelect() }} />
      </Group>
    )
  }

  if (doorStyle === 'double') {
    const angleRad = angle * Math.PI / 180
    const leftHinge = {
      x: pos.x - Math.cos(angleRad) * w / 2,
      y: pos.y - Math.sin(angleRad) * w / 2,
    }
    const rightHinge = {
      x: pos.x + Math.cos(angleRad) * w / 2,
      y: pos.y + Math.sin(angleRad) * w / 2,
    }
    const leafW = w / 2
    const normalAngle = angle + 90 * swingDirection
    const leftLeafEnd = {
      x: leftHinge.x + Math.cos(normalAngle * Math.PI / 180) * leafW,
      y: leftHinge.y + Math.sin(normalAngle * Math.PI / 180) * leafW,
    }
    const rightLeafEnd = {
      x: rightHinge.x + Math.cos(normalAngle * Math.PI / 180) * leafW,
      y: rightHinge.y + Math.sin(normalAngle * Math.PI / 180) * leafW,
    }

    return (
      <Group onClick={onSelect} onTap={onSelect} draggable={selected} onDragStart={pushHistory} onDragMove={dragAlongWall} onDragEnd={resetDragPosition}>
        <Line
          points={[leftHinge.x, leftHinge.y, rightHinge.x, rightHinge.y]}
          stroke={frameColor}
          strokeWidth={selected ? 3 : 2}
          lineCap="round"
        />
        <Line
          points={[leftHinge.x, leftHinge.y, leftLeafEnd.x, leftLeafEnd.y]}
          stroke={frameColor}
          strokeWidth={selected ? 2.5 : 2}
          lineCap="round"
        />
        <Line
          points={[rightHinge.x, rightHinge.y, rightLeafEnd.x, rightLeafEnd.y]}
          stroke={frameColor}
          strokeWidth={selected ? 2.5 : 2}
          lineCap="round"
        />
        <Arc
          x={leftHinge.x}
          y={leftHinge.y}
          innerRadius={0}
          outerRadius={leafW}
          angle={swingAngle}
          rotation={angle}
          stroke={frameColor}
          strokeWidth={1}
          fill={panelColor}
          dash={[4, 3]}
        />
        <Arc
          x={rightHinge.x}
          y={rightHinge.y}
          innerRadius={0}
          outerRadius={leafW}
          angle={swingAngle}
          rotation={angle + 90}
          stroke={frameColor}
          strokeWidth={1}
          fill={panelColor}
          dash={[4, 3]}
        />
        <Circle x={pos.x} y={pos.y} radius={opening.width / 2 + 6} fill="transparent" onClick={(e) => { stopKonvaBubble(e); onSelect() }} />
        {selected && (
          <>
            <Group x={pos.x} y={pos.y - 18} onMouseDown={stopKonvaBubble} onClick={(e) => { stopKonvaBubble(e); onDelete() }}>
              <Circle radius={8} fill="#ef4444" />
              <Text text="×" fontSize={13} fill="white" offsetX={4} offsetY={6} />
            </Group>
            <Circle
              x={pos.x + Math.cos(angleRad) * (opening.width / 2)}
              y={pos.y + Math.sin(angleRad) * (opening.width / 2)}
              radius={6}
              fill="#4f6ef7"
              draggable
              onMouseDown={stopKonvaBubble}
              onDragStart={(e) => { stopKonvaBubble(e); pushHistory() }}
              onDragMove={(e) => {
                stopKonvaBubble(e)
                const stage = e.target.getStage()!
                const world = pointerWorldPosition(stage)
                if (!world) return
                const dx = world.x - pos.x
                const dy = world.y - pos.y
                const wallDx = Math.cos(angleRad)
                const wallDy = Math.sin(angleRad)
                const proj = dx * wallDx + dy * wallDy
                onChange({ width: Math.max(50, Math.abs(proj) * 2) })
              }}
            />
            <Line points={[pos.x, pos.y, rotateHandleX, rotateHandleY]} stroke="#4f6ef7" strokeWidth={1} dash={[4, 3]} listening={false} />
            <Circle
              x={rotateHandleX}
              y={rotateHandleY}
              radius={8}
              fill="#4f6ef7"
              stroke="#fff"
              strokeWidth={1.5}
              draggable
              onMouseDown={stopKonvaBubble}
              onDragStart={(e) => { stopKonvaBubble(e); pushHistory() }}
              onDragMove={(e) => {
                stopKonvaBubble(e)
                const stage = e.target.getStage()!
                const ptr = stage.getPointerPosition()
                if (!ptr) return
                const scale = stage.scaleX() || 1
                const world = { x: (ptr.x - stage.x()) / scale, y: (ptr.y - stage.y()) / scale }
                const ang = Math.atan2(world.y - pos.y, world.x - pos.x) * (180 / Math.PI) + 90
                onChange({ rotation: Math.round(ang / 5) * 5 })
              }}
            />
            <RotateHandleIcon x={rotateHandleX} y={rotateHandleY} />
          </>
        )}
      </Group>
    )
  }

  return (
    <Group onClick={onSelect} onTap={onSelect} draggable={selected} onDragStart={pushHistory} onDragMove={dragAlongWall} onDragEnd={resetDragPosition}>
      {[swing].map((leafSwing, i) => {
        const hingeX = hx
        const hingeY = hy
        const leafW = w
        const leafDirection = leafSwing
        const leafAngle = angle + (leafDirection > 0 ? 90 : -90) * swingDirection
        return (
          <Group key={i}>
            <Line
              points={[
                hingeX,
                hingeY,
                hingeX + Math.cos(leafAngle * Math.PI / 180) * leafW,
                hingeY + Math.sin(leafAngle * Math.PI / 180) * leafW,
              ]}
              stroke={frameColor}
              strokeWidth={selected ? 2.5 : 2}
              lineCap="round"
            />
            <Arc
              x={hingeX} y={hingeY}
              innerRadius={0} outerRadius={leafW}
              angle={Math.abs(arcAngle)}
              rotation={leafDirection > 0 ? angle : angle - 90}
              stroke={frameColor}
              strokeWidth={1}
              fill={panelColor}
              dash={[4, 3]}
            />
          </Group>
        )
      })}
      <Circle x={pos.x} y={pos.y} radius={opening.width / 2 + 6} fill="transparent" onClick={(e) => { stopKonvaBubble(e); onSelect() }} />
      {selected && (
        <Group x={pos.x} y={pos.y - 18} onMouseDown={stopKonvaBubble} onClick={(e) => { stopKonvaBubble(e); onDelete() }}>
          <Circle radius={8} fill="#ef4444" />
          <Text text="×" fontSize={13} fill="white" offsetX={4} offsetY={6} />
        </Group>
      )}
      {/* 🔵 RESIZE HANDLE */}
      {selected && (
        <Circle
          x={pos.x + Math.cos(wallAngle(wall)) * (opening.width / 2)}
          y={pos.y + Math.sin(wallAngle(wall)) * (opening.width / 2)}
          radius={6}
          fill="#4f6ef7"
          draggable
          onMouseDown={stopKonvaBubble}
          onDragStart={(e) => { stopKonvaBubble(e); pushHistory() }}
          onDragMove={(e) => {
            stopKonvaBubble(e)
            const stage = e.target.getStage()!
            const world = pointerWorldPosition(stage)
            if (!world) return

            const dx = world.x - pos.x
            const dy = world.y - pos.y

            const wallDx = wall.end.x - wall.start.x
            const wallDy = wall.end.y - wall.start.y

            const wallLen = Math.hypot(wallDx, wallDy)

            const proj = (dx * wallDx + dy * wallDy) / wallLen

            const newWidth = Math.max(30, Math.abs(proj) * 2)

            onChange({
              width: newWidth,
              door_style: newWidth >= 80 ? 'double' : (opening.door_style ?? 'hinged'),
            })
          }}
        />
      )}

      {/* 🔵 ROTATE HANDLE */}
      {selected && (
        <>
          <Line
            points={[pos.x, pos.y, rotateHandleX, rotateHandleY]}
            stroke="#4f6ef7"
            strokeWidth={1}
            dash={[4, 3]}
            listening={false}
          />
          <Circle
            x={rotateHandleX}
            y={rotateHandleY}
            radius={8}
            fill="#4f6ef7"
            stroke="#fff"
            strokeWidth={1.5}
            draggable
            onMouseDown={stopKonvaBubble}
            onDragStart={(e) => { stopKonvaBubble(e); pushHistory() }}
            onDragMove={(e) => {
              stopKonvaBubble(e)
              const stage = e.target.getStage()!
              const ptr = stage.getPointerPosition()!
              if (!ptr) return

              const scale = stage.scaleX() || 1
              const world = {
                x: (ptr.x - stage.x()) / scale,
                y: (ptr.y - stage.y()) / scale,
              }

              const ang = Math.atan2(world.y - pos.y, world.x - pos.x) * (180 / Math.PI) + 90
              const snapped = Math.round(ang / 5) * 5
              onChange({ rotation: snapped })

              const nextRad = (snapped - 90) * Math.PI / 180
              e.target.x(pos.x + Math.cos(nextRad) * rotateHandleDistance)
              e.target.y(pos.y + Math.sin(nextRad) * rotateHandleDistance)
            }}
          />
          <RotateHandleIcon x={rotateHandleX} y={rotateHandleY} />
        </>
      )}
    </Group>
  )
}

// ─── Window 2D shape ─────────────────────────────────────────────────────────

function WindowShape({ wall, opening, selected, onSelect, onDelete, onChange }: {
  wall: Wall; opening: Opening; selected: boolean
  onSelect: () => void; onDelete: () => void; onChange:(u:Partial<Opening>) => void
}) {
  const pushHistory = useFloorPlanStore(s => s.pushHistory)
  const angle = wallAngle(wall)
  const pos = openingWorldPos(wall, opening)
  const w = opening.width
  const thick = wall.thickness + 4
  const perp = angle + Math.PI / 2

  const ax = Math.cos(angle) * w / 2
  const ay = Math.sin(angle) * w / 2
  const px = Math.cos(perp) * thick / 2
  const py = Math.sin(perp) * thick / 2
  const startX = pos.x - ax
  const startY = pos.y - ay
  const endX = pos.x + ax
  const endY = pos.y + ay
  const resizeHandleX = pos.x + Math.cos(angle) * (opening.width / 2)
  const resizeHandleY = pos.y + Math.sin(angle) * (opening.width / 2)

  return (
    <Group
      onClick={onSelect}
      onTap={onSelect}
      draggable={selected}
      onDragStart={pushHistory}
      onDragMove={(e) => {
        e.cancelBubble = true
        const stage = e.target.getStage()
        if (!stage) return
        const world = pointerWorldPosition(stage)
        if (!world) return
        const projected = projectOntoWall(world.x, world.y, wall)
        if (!projected) return
        onChange({ offset: projected.offset })
        e.target.x(0)
        e.target.y(0)
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true
        e.target.x(0)
        e.target.y(0)
      }}
    >
      {/* Wide transparent hit target keeps the slim symbol easy to select. */}
      <Line
        points={[startX, startY, endX, endY]}
        stroke="rgba(0,0,0,0.01)"
        strokeWidth={Math.max(18, thick + 8)}
      />
      {/* Single glazing line through the center of the wall opening. */}
      <Line
        points={[startX, startY, endX, endY]}
        stroke={selected ? WALL_SELECTED : '#4b5563'}
        strokeWidth={selected ? 2 : 1.25}
        lineCap="butt"
      />
      {/* Narrow jambs at each end, matching a clean plan-view window symbol. */}
      {[
        [startX, startY],
        [endX, endY],
      ].map(([x, y], index) => (
        <Line
          key={`window-jamb-${index}`}
          points={[x + px, y + py, x - px, y - py]}
          stroke={selected ? WALL_SELECTED : WINDOW_COLOR}
          strokeWidth={selected ? 2.2 : 1.6}
          lineCap="square"
        />
      ))}
      {selected && (
        <Group x={pos.x} y={pos.y - 18} onMouseDown={stopKonvaBubble} onClick={(e) => { stopKonvaBubble(e); onDelete() }}>
          <Circle radius={8} fill="#ef4444" />
          <Text text="×" fontSize={13} fill="white" offsetX={4} offsetY={6} />
        </Group>
      )}
      {selected && (
        <Circle
          x={resizeHandleX}
          y={resizeHandleY}
          radius={6}
          fill={WINDOW_COLOR}
          stroke="#fff"
          strokeWidth={1}
          draggable
          onMouseDown={stopKonvaBubble}
          onDragStart={(e) => { stopKonvaBubble(e); pushHistory() }}
          onDragMove={(e) => {
            stopKonvaBubble(e)
            const stage = e.target.getStage()
            if (!stage) return
            const world = pointerWorldPosition(stage)
            if (!world) return
            const dx = world.x - pos.x
            const dy = world.y - pos.y
            const wallDx = wall.end.x - wall.start.x
            const wallDy = wall.end.y - wall.start.y
            const wallLen = Math.hypot(wallDx, wallDy)
            if (wallLen === 0) return
            const proj = (dx * wallDx + dy * wallDy) / wallLen
            const wallPixelLength = wallLength(wall)
            const maxWidth = Math.max(20, wallPixelLength * 0.9)
            const newWidth = Math.min(maxWidth, Math.max(20, Math.abs(proj) * 2))
            onChange({ width: newWidth })
            e.target.x(pos.x + Math.cos(angle) * (newWidth / 2))
            e.target.y(pos.y + Math.sin(angle) * (newWidth / 2))
          }}
        />
      )}
    </Group>
  )
}

// ─── Wall shape with opening gaps ─────────────────────────────────────────────
//
// FIX: Removed the EXTEND hack that was blowing out corners. Instead we check
// whether a segment edge touches a wall endpoint — if it does we do NOT extend
// (the adjacent wall will cover that corner); if it's an interior gap edge we
// extend by half-thickness so the gap doesn't leave a sliver.

type WallRenderPass = 'outline' | 'fill' | 'details'
type ConnectedWallEndpoint = { wallId: string; endpoint: 'start' | 'end' }
type WallBodyConnection = ConnectedWallEndpoint & { point: Point }

function WallShape({ wall, openings, selected, tool, onSelect, onChange, onEndpointDrag, onWallBodyDrag, allWalls, measurementUnit, wallMeasurementMode, renderPass }: {
  wall: Wall; openings: Opening[]; selected: boolean; tool: Tool
  onSelect: () => void
  onChange: (u: Partial<Wall>) => void
  onEndpointDrag: (connected: ConnectedWallEndpoint[], pt: { x: number; y: number }) => void
  onWallBodyDrag: (connected: WallBodyConnection[], dx: number, dy: number) => void
  allWalls: Wall[]
  measurementUnit: MeasurementUnit
  wallMeasurementMode: WallMeasurementMode
  renderPass: WallRenderPass
}) {
  const pushHistory = useFloorPlanStore(s => s.pushHistory)
  const wallDrag = useRef<{
    start: { x: number; y: number }
    end: { x: number; y: number }
    pointer: { x: number; y: number }
    connections: WallBodyConnection[]
  } | null>(null)
  const len = wallLength(wall)
  const angle = wallAngle(wall)
  const thick = wall.thickness
  const wallFill = wall.wall_type?.includes('glass')
    ? '#c9eef8'
    : wall.wall_type === 'room-divider'
      ? '#d1d5db'
      : wall.color ?? '#ffffff'
  const wallDash = wall.wall_type === 'room-divider'
    ? [8, 5]
    : wall.wall_type === 'wall-hatching'
      ? [3, 3]
      : undefined
  const half = thick / 2
  const dimensionDrag = useRef<{
    offset: number
    pointer: Point
  } | null>(null)
  const perp = angle + Math.PI / 2
  const cosP = Math.cos(perp)
  const sinP = Math.sin(perp)

  const wallOpenings = openings
    .filter(o => o.wall_id === wall.id)
    .sort((a, b) => a.offset - b.offset)

  const gaps: Array<[number, number]> = wallOpenings.map(o => {
    const gapWidth = o.type === 'gate' ? o.width + wall.thickness : o.width
    const halfW = gapWidth / 2 / len
    return [Math.max(0, o.offset - halfW), Math.min(1, o.offset + halfW)]
  })

  const segments: Array<[number, number]> = []
  let cursor = 0
  for (const [gs, ge] of gaps) {
    if (cursor < gs) segments.push([cursor, gs])
    cursor = ge
  }
  if (cursor < 1) segments.push([cursor, 1])
  if (segments.length === 0 && gaps.length === 0) segments.push([0, 1])

  const midX = (wall.start.x + wall.end.x) / 2
  const midY = (wall.start.y + wall.end.y) / 2
  const planPoints = allWalls.flatMap(w => [w.start, w.end])
  const planCenter = planPoints.length
    ? {
        x: planPoints.reduce((sum, p) => sum + p.x, 0) / planPoints.length,
        y: planPoints.reduce((sum, p) => sum + p.y, 0) / planPoints.length,
      }
    : { x: midX, y: midY }
  const outwardSign = ((midX - planCenter.x) * Math.cos(perp) + (midY - planCenter.y) * Math.sin(perp)) >= 0 ? 1 : -1
  const dimNormalX = Math.cos(perp) * outwardSign
  const dimNormalY = Math.sin(perp) * outwardSign
  const dimOffset = wall.dimension_offset ?? half + 32
  const dimStart = {
    x: wall.start.x + dimNormalX * dimOffset,
    y: wall.start.y + dimNormalY * dimOffset,
  }
  const dimEnd = {
    x: wall.end.x + dimNormalX * dimOffset,
    y: wall.end.y + dimNormalY * dimOffset,
  }
  const dimMid = {
    x: midX + dimNormalX * dimOffset,
    y: midY + dimNormalY * dimOffset,
  }
  const wallAngleDeg = angle * 180 / Math.PI
  const textRotation = wallAngleDeg > 90 || wallAngleDeg < -90 ? wallAngleDeg + 180 : wallAngleDeg
  const bounds = allWalls.length
    ? allWalls.reduce(
        (acc, w) => ({
          minX: Math.min(acc.minX, w.start.x, w.end.x),
          maxX: Math.max(acc.maxX, w.start.x, w.end.x),
          minY: Math.min(acc.minY, w.start.y, w.end.y),
          maxY: Math.max(acc.maxY, w.start.y, w.end.y),
        }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
      )
    : { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  const outerTolerance = Math.max(12, thick * 2)
  const isOuterWall = Math.abs(midX - bounds.minX) <= outerTolerance
    || Math.abs(midX - bounds.maxX) <= outerTolerance
    || Math.abs(midY - bounds.minY) <= outerTolerance
    || Math.abs(midY - bounds.maxY) <= outerTolerance
  const showWallMeasurement = wallMeasurementMode === 'all'
    || (wallMeasurementMode === 'outer' && isOuterWall)
  /**
   * Build the 4-corner polygon for a wall segment [t0, t1].
   * We no longer blindly extend every edge — we only extend edges that
   * are at an interior gap boundary (not at t=0 or t=1). This prevents
   * the ugly protrusions at shared corners.
   */
  function segPoints(t0: number, t1: number): number[] {
    const dxLine = wall.end.x - wall.start.x
    const dyLine = wall.end.y - wall.start.y

    // Start point — extend inward a tiny bit only if this is a gap edge
    const startExtend = t0 > 0 ? -1 : 0
    const endExtend   = t1 < 1 ? 1  : 0

    const sx = wall.start.x + dxLine * t0 + Math.cos(angle) * startExtend
    const sy = wall.start.y + dyLine * t0 + Math.sin(angle) * startExtend
    const ex = wall.start.x + dxLine * t1 + Math.cos(angle) * endExtend
    const ey = wall.start.y + dyLine * t1 + Math.sin(angle) * endExtend

    return [
      sx + cosP * half, sy + sinP * half,
      ex + cosP * half, ey + sinP * half,
      ex - cosP * half, ey - sinP * half,
      sx - cosP * half, sy - sinP * half,
    ]
  }

  return (
    <Group
      onClick={renderPass === 'fill' ? onSelect : undefined}
      onTap={renderPass === 'fill' ? onSelect : undefined}
      draggable={renderPass === 'fill' && tool === 'select' && selected}
      listening={renderPass !== 'outline'}
      onDragStart={(e) => {
        stopKonvaBubble(e)
        if (renderPass !== 'fill') return
        pushHistory()
        const connectionTolerance = Math.max(6, wall.thickness / 2 + 2)
        const connectedToWall = allWalls.flatMap((w) => {
          const connected: WallBodyConnection[] = []
          const endpoints = [
            ['start', w.start],
            ['end', w.end],
          ] as const
          endpoints.forEach(([endpoint, point]) => {
            const touchesStart = Math.hypot(point.x - wall.start.x, point.y - wall.start.y) <= connectionTolerance
            const touchesEnd = Math.hypot(point.x - wall.end.x, point.y - wall.end.y) <= connectionTolerance
            const projection = projectOntoWall(point.x, point.y, wall)
            const touchesBody = projection
              && projection.dist <= connectionTolerance
              && projection.offset > 0.01
              && projection.offset < 0.99
            if (w.id === wall.id || touchesStart || touchesEnd || touchesBody) {
              connected.push({ wallId: w.id, endpoint, point: { ...point } })
            }
          })
          return connected
        })
        wallDrag.current = {
          start: { ...wall.start },
          end: { ...wall.end },
          pointer: pointerWorldPosition(e.target.getStage()!) ?? { x: wall.start.x, y: wall.start.y },
          connections: connectedToWall,
        }
      }}
      onDragMove={(e) => {
        stopKonvaBubble(e)
        if (renderPass !== 'fill' || !wallDrag.current) return
        const world = pointerWorldPosition(e.target.getStage()!)
        if (!world) return
        const dx = world.x - wallDrag.current.pointer.x
        const dy = world.y - wallDrag.current.pointer.y
        onWallBodyDrag(wallDrag.current.connections, dx, dy)
        e.target.x(0); e.target.y(0)
      }}
      onDragEnd={(e) => {
        stopKonvaBubble(e)
        if (renderPass !== 'fill') return
        e.target.x(0); e.target.y(0)
        wallDrag.current = null
      }}
    >
      {renderPass !== 'details' && segments.map(([t0, t1], i) => {
        // Square line caps already extend by half the stroke width. Extending
        // the center line as well doubles the overlap and creates cross-shaped
        // blocks at corners and T-junctions.
        const sx = wall.start.x + (wall.end.x - wall.start.x) * t0
        const sy = wall.start.y + (wall.end.y - wall.start.y) * t0
        const ex = wall.start.x + (wall.end.x - wall.start.x) * t1
        const ey = wall.start.y + (wall.end.y - wall.start.y) * t1
        const curveOffset = wall.curved ? len * 0.14 : 0
        const linePoints = wall.curved
          ? [sx, sy, (sx + ex) / 2 + cosP * curveOffset, (sy + ey) / 2 + sinP * curveOffset, ex, ey]
          : [sx, sy, ex, ey]

        return (
          <Group key={i}>
            {renderPass === 'outline' && selected && (
              <Line
                points={linePoints}
                tension={wall.curved ? 0.5 : 0}
                stroke={WALL_SELECTED}
                strokeWidth={thick + 6}
                lineCap="square"
                lineJoin="miter"
                listening={false}
              />
            )}
            {renderPass === 'outline' && (
              <Line
                points={linePoints}
                tension={wall.curved ? 0.5 : 0}
                stroke="#111827"
                strokeWidth={thick + 2}
                lineCap="square"
                lineJoin="miter"
                listening={false}
              />
            )}
            {renderPass === 'fill' && (
              <>
                <Line
                  points={linePoints}
                  tension={wall.curved ? 0.5 : 0}
                  stroke={wallFill}
                  strokeWidth={Math.max(1, thick - 2)}
                  lineCap="square"
                  lineJoin="miter"
                  dash={wallDash}
                />
                {selected && tool === 'select' && (
                  <Line
                    points={linePoints}
                    tension={wall.curved ? 0.5 : 0}
                    stroke="rgba(255,255,255,0.01)"
                    strokeWidth={Math.max(thick + 14, 24)}
                    lineCap="square"
                    lineJoin="miter"
                  />
                )}
              </>
            )}
          </Group>
        )
      })}

      {/* Fill opening gaps so they look transparent (cut through the wall) */}
      {renderPass === 'details' && gaps.map(([gs, ge], i) => {
        const sx = wall.start.x + (wall.end.x - wall.start.x) * gs
        const sy = wall.start.y + (wall.end.y - wall.start.y) * gs
        const ex = wall.start.x + (wall.end.x - wall.start.x) * ge
        const ey = wall.start.y + (wall.end.y - wall.start.y) * ge
        return (
          <Line
            key={`gap-${i}`}
            points={[
              sx + cosP * half, sy + sinP * half,
              ex + cosP * half, ey + sinP * half,
              ex - cosP * half, ey - sinP * half,
              sx - cosP * half, sy - sinP * half,
            ]}
            closed
            fill="#f5f5f5"
            stroke="#16191f"
            strokeWidth={2}
            listening={false}
          />
        )
      })}

      {renderPass === 'details' && showWallMeasurement && len > 20 && (
        <Group
          draggable={tool === 'select'}
          onClick={onSelect}
          onTap={onSelect}
          onDragStart={(e) => {
            stopKonvaBubble(e)
            onSelect()
            pushHistory()
            const world = pointerWorldPosition(e.target.getStage()!)
            dimensionDrag.current = {
              offset: dimOffset,
              pointer: world ?? dimMid,
            }
            e.target.x(0)
            e.target.y(0)
          }}
          onDragMove={(e) => {
            stopKonvaBubble(e)
            const world = pointerWorldPosition(e.target.getStage()!)
            if (!world || !dimensionDrag.current) return
            const dragDelta =
              (world.x - dimensionDrag.current.pointer.x) * dimNormalX +
              (world.y - dimensionDrag.current.pointer.y) * dimNormalY
            const startOffset = dimensionDrag.current.offset
            const nextOffset = Math.max(half + 10, Math.min(260, startOffset + dragDelta))
            onChange({ dimension_offset: nextOffset })
            e.target.x(0)
            e.target.y(0)
          }}
          onDragEnd={(e) => {
            stopKonvaBubble(e)
            e.target.x(0)
            e.target.y(0)
            dimensionDrag.current = null
          }}
        >
          <Line
            points={[dimStart.x, dimStart.y, dimEnd.x, dimEnd.y]}
            stroke="rgba(79,110,247,0.01)"
            strokeWidth={18}
            lineCap="round"
          />
          <Line
            points={[
              wall.start.x + dimNormalX * half,
              wall.start.y + dimNormalY * half,
              dimStart.x,
              dimStart.y,
            ]}
            stroke="#374151"
            strokeWidth={0.8}
            opacity={0.78}
          />
          <Line
            points={[
              wall.end.x + dimNormalX * half,
              wall.end.y + dimNormalY * half,
              dimEnd.x,
              dimEnd.y,
            ]}
            stroke="#374151"
            strokeWidth={0.8}
            opacity={0.78}
          />
          <Line
            points={[dimStart.x, dimStart.y, dimEnd.x, dimEnd.y]}
            stroke={selected ? '#4f6ef7' : '#374151'}
            strokeWidth={0.9}
            opacity={0.85}
          />
          <Line
            points={[
              dimStart.x - dimNormalX * 4,
              dimStart.y - dimNormalY * 4,
              dimStart.x + dimNormalX * 4,
              dimStart.y + dimNormalY * 4,
            ]}
            stroke="#374151"
            strokeWidth={0.9}
          />
          <Line
            points={[
              dimEnd.x - dimNormalX * 4,
              dimEnd.y - dimNormalY * 4,
              dimEnd.x + dimNormalX * 4,
              dimEnd.y + dimNormalY * 4,
            ]}
            stroke="#374151"
            strokeWidth={0.9}
          />
          <Text
            x={dimMid.x}
            y={dimMid.y}
            text={formatLength(len, measurementUnit)}
            fill={selected ? '#4f6ef7' : '#374151'}
            fontSize={10}
            rotation={textRotation}
            offsetX={24}
            offsetY={14}
          />
        </Group>
      )}

      {renderPass === 'details' && selected && tool === 'select' && (
        <>
          <EndHandle x={wall.start.x} y={wall.start.y} allWalls={allWalls}
            onDrag={(anchor, pt) => onEndpointDrag(anchor, pt)} />
          <EndHandle x={wall.end.x} y={wall.end.y} allWalls={allWalls}
            onDrag={(anchor, pt) => onEndpointDrag(anchor, pt)} />
        </>
      )}
    </Group>
  )
}

function EndHandle({ x, y, onDrag, allWalls }: {
  x: number; y: number
  onDrag: (connected: ConnectedWallEndpoint[], pt: { x: number; y: number }) => void
  allWalls: Wall[]
}) {
  const pushHistory = useFloorPlanStore(s => s.pushHistory)
  const dragConnections = useRef<ConnectedWallEndpoint[]>([])
  return (
    <Circle x={x} y={y} radius={4.5}
      fill="#4f6ef7" stroke="#fff" strokeWidth={1.5}
      draggable
      onDragStart={() => {
        pushHistory()
        const connectionTolerance = 8
        dragConnections.current = allWalls.flatMap((w) => {
          const connected: ConnectedWallEndpoint[] = []
          if (Math.hypot(w.start.x - x, w.start.y - y) <= connectionTolerance) connected.push({ wallId: w.id, endpoint: 'start' })
          if (Math.hypot(w.end.x - x, w.end.y - y) <= connectionTolerance) connected.push({ wallId: w.id, endpoint: 'end' })
          return connected
        })
      }}
      onDragMove={(e) => {
        const raw = { x: e.target.x(), y: e.target.y() }
        const snapped = snapDraggedEndpoint(raw.x, raw.y, allWalls, dragConnections.current)
        e.target.x(snapped.x); e.target.y(snapped.y)
        onDrag(dragConnections.current, snapped)
      }}
      onDragEnd={() => { dragConnections.current = [] }}
    />
  )
}

// ─── Furniture shape ──────────────────────────────────────────────────────────

function FurnitureShape({ obj, selected, tool, onSelect, onChange, onEditText, onStairContextMenu }: {
  obj: PlacedObject; selected: boolean; tool: Tool
  onSelect: () => void
  onChange: (u: Partial<PlacedObject>) => void
  onEditText?: () => void
  onStairContextMenu?: (event: Konva.KonvaEventObject<PointerEvent>) => void
}) {
  type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'
  type ResizeHandle = [ResizeCorner, number, number, number, number]
  type ResizeSide = 'left' | 'right' | 'top' | 'bottom'
  const pushHistory = useFloorPlanStore(s => s.pushHistory)
  const resizeStart = useRef<{
    x: number
    y: number
    width: number
    height: number
    rotation: number
    leftRunWidth: number
    rightRunWidth: number
    landingWidth: number
  } | null>(null)
  const minSize = 20
  const getReturnDimensions = () => {
    const legacyLandingWidth = Math.min(obj.width * 0.34, Math.max(34, obj.landing_width ?? 80))
    const landingWidth = obj.landing_width ?? obj.landingWidth ?? legacyLandingWidth
    const legacyRunWidth = Math.max(12, obj.width - landingWidth)
    return {
      landingWidth,
      leftRunWidth: obj.left_run_width ?? obj.leftRunWidth ?? legacyRunWidth,
      rightRunWidth: obj.right_run_width ?? obj.rightRunWidth ?? legacyRunWidth,
    }
  }

  const handleResizeStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    stopKonvaBubble(e)
    pushHistory()
    const returnDimensions = getReturnDimensions()
    resizeStart.current = {
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      rotation: obj.rotation,
      ...returnDimensions,
    }
  }

  const handleResize = (
    corner: ResizeCorner,
    visualOffset = { x: 0, y: 0 }
  ) => (e: Konva.KonvaEventObject<DragEvent>) => {
    stopKonvaBubble(e)
    const start = resizeStart.current
    if (!start) return

    const opposite = {
      nw: { x: start.width / 2, y: start.height / 2 },
      ne: { x: -start.width / 2, y: start.height / 2 },
      sw: { x: start.width / 2, y: -start.height / 2 },
      se: { x: -start.width / 2, y: -start.height / 2 },
    }[corner]

    const draggedX = e.target.x() - visualOffset.x
    const draggedY = e.target.y() - visualOffset.y
    const rawWidth = Math.abs(draggedX - opposite.x)
    const rawHeight = Math.abs(draggedY - opposite.y)
    const nextWidth = Math.max(minSize, rawWidth)
    const nextHeight = Math.max(minSize, rawHeight)

    const xSign = corner === 'ne' || corner === 'se' ? 1 : -1
    const ySign = corner === 'sw' || corner === 'se' ? 1 : -1
    const dragged = {
      x: opposite.x + nextWidth * xSign,
      y: opposite.y + nextHeight * ySign,
    }
    const localCenterShift = {
      x: (opposite.x + dragged.x) / 2,
      y: (opposite.y + dragged.y) / 2,
    }
    const rotation = (start.rotation * Math.PI) / 180
    const worldShift = {
      x: localCenterShift.x * Math.cos(rotation) - localCenterShift.y * Math.sin(rotation),
      y: localCenterShift.x * Math.sin(rotation) + localCenterShift.y * Math.cos(rotation),
    }

    onChange({
      x: start.x + worldShift.x,
      y: start.y + worldShift.y,
      width: nextWidth,
      height: nextHeight,
    })

    e.target.x((nextWidth / 2) * xSign + visualOffset.x)
    e.target.y((nextHeight / 2) * ySign + visualOffset.y)
  }

  const handleResizeEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    stopKonvaBubble(e)
    resizeStart.current = null
  }

  const getResizeLocalPointer = (
    e: Konva.KonvaEventObject<DragEvent>,
    start: NonNullable<typeof resizeStart.current>,
  ) => {
    const world = pointerWorldPosition(e.target.getStage()!)
    if (!world) return null
    const dx = world.x - start.x
    const dy = world.y - start.y
    const rotation = (start.rotation * Math.PI) / 180
    return {
      x: dx * Math.cos(rotation) + dy * Math.sin(rotation),
      y: -dx * Math.sin(rotation) + dy * Math.cos(rotation),
    }
  }

  const handleSideResize = (side: ResizeSide) => (e: Konva.KonvaEventObject<DragEvent>) => {
    stopKonvaBubble(e)
    const start = resizeStart.current
    if (!start) return

    const pointer = getResizeLocalPointer(e, start)
    if (!pointer) return
    const horizontal = side === 'left' || side === 'right'
    const dragged = horizontal ? pointer.x : pointer.y
    const fixedEdge = side === 'left'
      ? start.width / 2
      : side === 'right'
        ? -start.width / 2
        : side === 'top'
          ? start.height / 2
          : -start.height / 2
    const rawSize = side === 'left' || side === 'top'
      ? fixedEdge - dragged
      : dragged - fixedEdge
    const nextSize = Math.max(minSize, rawSize)
    const sign = side === 'right' || side === 'bottom' ? 1 : -1
    const resizedEdge = fixedEdge + nextSize * sign
    const localCenterShift = (fixedEdge + resizedEdge) / 2
    const rotation = (start.rotation * Math.PI) / 180
    const localShiftX = horizontal ? localCenterShift : 0
    const localShiftY = horizontal ? 0 : localCenterShift
    const worldShiftX = localShiftX * Math.cos(rotation) - localShiftY * Math.sin(rotation)
    const worldShiftY = localShiftX * Math.sin(rotation) + localShiftY * Math.cos(rotation)

    onChange({
      x: start.x + worldShiftX,
      y: start.y + worldShiftY,
      ...(horizontal ? { width: nextSize } : { height: nextSize }),
    })

    if (horizontal) {
      e.target.x(sign * nextSize / 2)
      e.target.y(0)
    } else {
      e.target.x(0)
      e.target.y(sign * nextSize / 2)
    }
  }

  const handleLandingFlightResizeStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    stopKonvaBubble(e)
    pushHistory()
    const returnDimensions = getReturnDimensions()
    resizeStart.current = {
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      rotation: obj.rotation,
      ...returnDimensions,
    }
  }

  const handleLandingFlightResize = (e: Konva.KonvaEventObject<DragEvent>) => {
    stopKonvaBubble(e)
    const start = resizeStart.current
    if (!start) return

    const landingDepth = Math.min(start.height * 0.58, Math.max(34, obj.landing_depth ?? 80))
    const turnRight = obj.landing_turn === 'right'
    const draggedY = e.target.y()
    const nextHeight = turnRight
      ? Math.max(landingDepth + 56, draggedY * 2 + 20)
      : Math.max(landingDepth + 56, Math.abs(draggedY) * 2 + 20)

    onChange({ height: nextHeight })
  }

  const handleLandingFlightResizeEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    stopKonvaBubble(e)
    resizeStart.current = null
  }

  const handleReturnMiddleResize = (e: Konva.KonvaEventObject<DragEvent>) => {
    stopKonvaBubble(e)
    const start = resizeStart.current
    if (!start) return

    const pointer = getResizeLocalPointer(e, start)
    if (!pointer) return
    const runHeight = Math.max(22, obj.landing_depth ?? 80)
    const middleLength = Math.max(10, Math.abs(pointer.y) * 2)
    onChange({ height: runHeight * 2 + middleLength })
  }

  const handleReturnRunLengthResize = (
    run: 'left' | 'right',
  ) => (e: Konva.KonvaEventObject<DragEvent>) => {
    stopKonvaBubble(e)
    const start = resizeStart.current
    if (!start) return

    const pointer = getResizeLocalPointer(e, start)
    if (!pointer) return
    const mirrored = obj.landing_turn === 'right'
    const fixedLandingEdge = mirrored ? -start.width / 2 : start.width / 2
    const landingJoin = mirrored
      ? fixedLandingEdge + start.landingWidth
      : fixedLandingEdge - start.landingWidth
    const nextRunWidth = Math.max(
      12,
      mirrored ? pointer.x - landingJoin : landingJoin - pointer.x,
    )
    const nextLeftRunWidth = run === 'left' ? nextRunWidth : start.leftRunWidth
    const nextRightRunWidth = run === 'right' ? nextRunWidth : start.rightRunWidth
    const nextWidth = start.landingWidth + Math.max(nextLeftRunWidth, nextRightRunWidth)
    const localCenterShift = mirrored
      ? (nextWidth - start.width) / 2
      : -(nextWidth - start.width) / 2
    const rotation = (start.rotation * Math.PI) / 180

    onChange({
      x: start.x + localCenterShift * Math.cos(rotation),
      y: start.y + localCenterShift * Math.sin(rotation),
      width: nextWidth,
      left_run_width: nextLeftRunWidth,
      right_run_width: nextRightRunWidth,
      landing_width: start.landingWidth,
    })
  }

  const renderSymbol = () => {
    const w = obj.width
    const h = obj.height
    const sketch = '#111827'
    const selectedStroke = selected ? WALL_SELECTED : sketch
    const strokeWidth = selected ? 2.4 : 1.6
    const detailWidth = selected ? 1.5 : 1.1
    const fill = '#ffffff'

    if (obj.type === 'bed' || obj.type === 'bed_s') {
      return (
        <>
          <Rect offsetX={w / 2} offsetY={h / 2} width={w} height={h} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={3} />
          <Rect x={-w / 2 + 8} y={-h / 2 + 9} width={w / 2 - 13} height={h * 0.16} fill={fill} stroke={sketch} strokeWidth={detailWidth} cornerRadius={2} />
          {obj.type === 'bed' && <Rect x={5} y={-h / 2 + 9} width={w / 2 - 13} height={h * 0.16} fill={fill} stroke={sketch} strokeWidth={detailWidth} cornerRadius={2} />}
          <Line points={[-w / 2 + 7, -h / 2 + h * 0.3, w / 2 - 7, -h / 2 + h * 0.3]} stroke={sketch} strokeWidth={detailWidth} />
          <Line points={[-w / 2 + 10, h / 2 - 12, w / 2 - 10, h / 2 - 12]} stroke={sketch} strokeWidth={detailWidth} />
        </>
      )
    }

    if (obj.type === 'sofa') {
      return (
        <>
          <Rect x={-w / 2 + 12} y={-h / 2 + 6} width={w - 24} height={h * 0.34} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={3} />
          <Rect x={-w / 2 + 4} y={-h / 2 + h * 0.3} width={w - 8} height={h * 0.5} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={4} />
          <Rect x={-w / 2} y={-h / 2 + h * 0.24} width={13} height={h * 0.6} fill={fill} stroke={sketch} strokeWidth={detailWidth} cornerRadius={3} />
          <Rect x={w / 2 - 13} y={-h / 2 + h * 0.24} width={13} height={h * 0.6} fill={fill} stroke={sketch} strokeWidth={detailWidth} cornerRadius={3} />
          <Line points={[0, -h / 2 + h * 0.34, 0, h / 2 - 8]} stroke={sketch} strokeWidth={detailWidth} />
        </>
      )
    }

    if (obj.type === 'table' || obj.type === 'desk') {
      if (obj.type === 'table') {
        return (
          <>
            <Rect offsetX={w / 2} offsetY={h / 2} width={w} height={h} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={Math.min(w, h) / 2} />
            <Circle radius={Math.min(w, h) * 0.24} fill={fill} stroke={sketch} strokeWidth={detailWidth} />
            <Circle x={-w * 0.32} y={-h * 0.25} radius={3} fill={sketch} />
            <Circle x={w * 0.32} y={-h * 0.25} radius={3} fill={sketch} />
            <Circle x={-w * 0.32} y={h * 0.25} radius={3} fill={sketch} />
            <Circle x={w * 0.32} y={h * 0.25} radius={3} fill={sketch} />
          </>
        )
      }

      return (
        <>
          <Rect offsetX={w / 2} offsetY={h / 2} width={w} height={h} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={3} />
          <Line points={[-w / 2 + 10, -h / 2 + 14, w / 2 - 10, -h / 2 + 14]} stroke={sketch} strokeWidth={detailWidth} />
          <Rect x={w / 2 - 32} y={h / 2 - 18} width={20} height={8} fill={fill} stroke={sketch} strokeWidth={detailWidth} cornerRadius={1} />
        </>
      )
    }

    if (obj.type === 'chair') {
      return (
        <>
          <Rect x={-w / 2 + 8} y={-h / 2 + 5} width={w - 16} height={h * 0.22} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={2} />
          <Rect x={-w / 2 + 9} y={-h / 2 + h * 0.32} width={w - 18} height={h * 0.43} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={3} />
          <Line points={[-w / 2 + 12, h / 2 - 7, -w / 2 + 4, h / 2 - 1]} stroke={sketch} strokeWidth={detailWidth} lineCap="round" />
          <Line points={[w / 2 - 12, h / 2 - 7, w / 2 - 4, h / 2 - 1]} stroke={sketch} strokeWidth={detailWidth} lineCap="round" />
        </>
      )
    }

    if (obj.type === 'stairs') {
      const treadCount = Math.max(6, obj.stair_steps ?? Math.round(w / 16))
      const inset = 10
      const stairFill = '#fbfcfd'
      const landingFill = '#eef2f6'
      const railStroke = selected ? WALL_SELECTED : '#334155'
      const treadStroke = '#596575'
      const arrowStroke = '#26313d'
      if (obj.stair_shape === 'landing') {
        const landingW = Math.min(w * 0.42, Math.max(34, obj.landing_width ?? 80))
        const landingH = Math.min(h * 0.58, Math.max(34, obj.landing_depth ?? 80))
        const firstRunW = Math.max(28, w - landingW)
        const secondRunH = Math.max(28, (h - landingH) / 2)
        const firstSteps = Math.max(4, Math.floor(treadCount / 2))
        const secondSteps = Math.max(4, treadCount - firstSteps)
        const landingX = w / 2 - landingW
        const turnRight = obj.landing_turn === 'right'
        const landingY = -landingH / 2
        const secondRunY = turnRight ? landingY + landingH : landingY - secondRunH
        const arrowEndY = turnRight ? h / 2 - inset - 4 : -h / 2 + inset + 4
        return (
          <>
            <Rect x={-w / 2} y={landingY} width={firstRunW} height={landingH} fill={stairFill} stroke="#d6dde5" strokeWidth={1} cornerRadius={3} />
            <Rect x={landingX} y={landingY} width={landingW} height={landingH} fill={landingFill} stroke="#d6dde5" strokeWidth={1} cornerRadius={3} />
            <Rect x={landingX} y={secondRunY} width={landingW} height={secondRunH} fill={stairFill} stroke="#d6dde5" strokeWidth={1} cornerRadius={3} />
            <Line points={[-w / 2 + inset, landingY + 5, -w / 2 + inset, landingY + landingH - 5]} stroke={railStroke} strokeWidth={detailWidth + 0.4} lineCap="round" />
            <Line points={[w / 2 - inset, Math.min(landingY, secondRunY) + 5, w / 2 - inset, Math.max(landingY + landingH, secondRunY + secondRunH) - 5]} stroke={railStroke} strokeWidth={detailWidth + 0.4} lineCap="round" />
            <Line points={[landingX + 5, secondRunY + (turnRight ? secondRunH - inset : inset), w / 2 - 5, secondRunY + (turnRight ? secondRunH - inset : inset)]} stroke={railStroke} strokeWidth={detailWidth + 0.4} lineCap="round" />
            {Array.from({ length: firstSteps + 1 }).map((_, i) => {
              const x = -w / 2 + inset + ((firstRunW - inset * 2) / firstSteps) * i
              return <Line key={`first-${i}`} points={[x, landingY + 6, x, landingY + landingH - 6]} stroke={treadStroke} strokeWidth={0.85} opacity={0.72} />
            })}
            {Array.from({ length: secondSteps + 1 }).map((_, i) => {
              const y = turnRight
                ? landingY + landingH + (secondRunH / secondSteps) * i
                : landingY - (secondRunH / secondSteps) * i
              return <Line key={`second-${i}`} points={[landingX + 6, y, w / 2 - 6, y]} stroke={treadStroke} strokeWidth={0.85} opacity={0.72} />
            })}
            <Arrow
              points={[-w / 2 + inset + 4, landingY + landingH / 2, landingX + landingW / 2, landingY + landingH / 2, landingX + landingW / 2, arrowEndY]}
              stroke={arrowStroke}
              fill={arrowStroke}
              strokeWidth={1.4}
              pointerLength={5}
              pointerWidth={5}
            />
          </>
        )
      }
      if (obj.stair_shape === 'return_landing') {
        const legacyLandingW = Math.min(w * 0.34, Math.max(34, obj.landing_width ?? 80))
        const landingW = obj.landing_width ?? obj.landingWidth ?? legacyLandingW
        const legacyRunW = Math.max(12, w - landingW)
        const leftRunW = obj.left_run_width ?? obj.leftRunWidth ?? legacyRunW
        const rightRunW = obj.right_run_width ?? obj.rightRunWidth ?? legacyRunW
        const runH = Math.min(Math.max(22, obj.landing_depth ?? 80), Math.max(22, (h - 10) / 2))
        const lowerY = h / 2 - runH
        const upperY = -h / 2
        const mirrored = obj.landing_turn === 'right'
        const landingX = mirrored ? -w / 2 : w / 2 - landingW
        const landingJoinX = mirrored ? landingX + landingW : landingX
        const lowerRunX = mirrored ? landingJoinX : landingJoinX - leftRunW
        const upperRunX = mirrored ? landingJoinX : landingJoinX - rightRunW
        const lowerRailX = mirrored ? lowerRunX + leftRunW - inset : lowerRunX + inset
        const upperRailX = mirrored ? upperRunX + rightRunW - inset : upperRunX + inset
        const landingRailX = mirrored ? -w / 2 + inset : w / 2 - inset
        const lowerArrowEdgeX = mirrored ? lowerRunX + leftRunW - inset - 4 : lowerRunX + inset + 4
        const upperArrowEdgeX = mirrored ? upperRunX + rightRunW - inset - 4 : upperRunX + inset + 4
        const landingCenterX = landingX + landingW / 2
        const firstSteps = Math.max(4, Math.floor(treadCount / 2))
        const secondSteps = Math.max(4, treadCount - firstSteps)
        return (
          <>
            <Rect x={lowerRunX} y={lowerY} width={leftRunW} height={runH} fill={stairFill} stroke="#d6dde5" strokeWidth={1} cornerRadius={3} />
            <Rect x={landingX} y={upperY} width={landingW} height={h} fill={landingFill} stroke="#d6dde5" strokeWidth={1} cornerRadius={3} />
            <Rect x={upperRunX} y={upperY} width={rightRunW} height={runH} fill={stairFill} stroke="#d6dde5" strokeWidth={1} cornerRadius={3} />
            <Line points={[lowerRailX, lowerY + 5, lowerRailX, lowerY + runH - 5]} stroke={railStroke} strokeWidth={detailWidth + 0.4} lineCap="round" />
            <Line points={[upperRailX, upperY + 5, upperRailX, upperY + runH - 5]} stroke={railStroke} strokeWidth={detailWidth + 0.4} lineCap="round" />
            <Line points={[landingRailX, upperY + 5, landingRailX, h / 2 - 5]} stroke={railStroke} strokeWidth={detailWidth + 0.4} lineCap="round" />
            {Array.from({ length: firstSteps + 1 }).map((_, i) => {
              const x = lowerRunX + inset + ((leftRunW - inset * 2) / firstSteps) * i
              return <Line key={`return-first-${i}`} points={[x, lowerY + 6, x, lowerY + runH - 6]} stroke={treadStroke} strokeWidth={0.85} opacity={0.72} />
            })}
            {Array.from({ length: secondSteps + 1 }).map((_, i) => {
              const x = upperRunX + inset + ((rightRunW - inset * 2) / secondSteps) * i
              return <Line key={`return-second-${i}`} points={[x, upperY + 6, x, upperY + runH - 6]} stroke={treadStroke} strokeWidth={0.85} opacity={0.72} />
            })}
            <Arrow
              points={[lowerArrowEdgeX, lowerY + runH / 2, landingCenterX, lowerY + runH / 2, landingCenterX, upperY + runH / 2, upperArrowEdgeX, upperY + runH / 2]}
              stroke={arrowStroke}
              fill={arrowStroke}
              strokeWidth={1.4}
              pointerLength={5}
              pointerWidth={5}
            />
          </>
        )
      }
      return (
        <>
          <Rect
            offsetX={w / 2}
            offsetY={h / 2}
            width={w}
            height={h}
            fill={stairFill}
            stroke="#d6dde5"
            strokeWidth={1}
            cornerRadius={3}
          />
          <Line points={[-w / 2 + inset, -h / 2 + 5, -w / 2 + inset, h / 2 - 5]} stroke={railStroke} strokeWidth={detailWidth + 0.4} lineCap="round" />
          <Line points={[w / 2 - inset, -h / 2 + 5, w / 2 - inset, h / 2 - 5]} stroke={railStroke} strokeWidth={detailWidth + 0.4} lineCap="round" />
          {Array.from({ length: treadCount + 1 }).map((_, i) => {
            const x = -w / 2 + inset + ((w - inset * 2) / treadCount) * i
            return <Line key={i} points={[x, -h / 2 + 6, x, h / 2 - 6]} stroke={treadStroke} strokeWidth={0.85} opacity={0.7} />
          })}
          <Arrow
            points={[-w / 2 + inset + 4, 0, w / 2 - inset - 4, 0]}
            stroke={arrowStroke}
            fill={arrowStroke}
            strokeWidth={1.4}
            pointerLength={5}
            pointerWidth={5}
          />
        </>
      )
    }

    if (obj.type === 'wardrobe') {
      return (
        <>
          <Rect offsetX={w / 2} offsetY={h / 2} width={w} height={h} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={2} />
          <Line points={[0, -h / 2 + 6, 0, h / 2 - 6]} stroke={sketch} strokeWidth={detailWidth} />
          <Circle x={-5} y={0} radius={2} fill={sketch} />
          <Circle x={5} y={0} radius={2} fill={sketch} />
        </>
      )
    }

    if (obj.type === 'bath') {
      return (
        <>
          <Rect offsetX={w / 2} offsetY={h / 2} width={w} height={h} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={10} />
          <Rect x={-w / 2 + 8} y={-h / 2 + 10} width={w - 16} height={h - 20} fill={fill} stroke={sketch} strokeWidth={detailWidth} cornerRadius={8} />
          <Circle x={0} y={-h / 2 + 18} radius={4} fill={fill} stroke={sketch} strokeWidth={detailWidth} />
        </>
      )
    }

    if (obj.type === 'toilet') {
      return (
        <>
          <Rect x={-w / 2 + 7} y={-h / 2 + 4} width={w - 14} height={h * 0.3} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={3} />
          <Circle y={h * 0.12} radius={Math.min(w, h) * 0.28} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} />
          <Circle y={h * 0.12} radius={Math.min(w, h) * 0.14} fill={fill} stroke={sketch} strokeWidth={detailWidth} />
        </>
      )
    }

    if (obj.type === 'sink') {
      return (
        <>
          <Rect offsetX={w / 2} offsetY={h / 2} width={w} height={h} fill={fill} stroke={selectedStroke} strokeWidth={strokeWidth} cornerRadius={4} />
          <Circle radius={Math.min(w, h) * 0.28} fill={fill} stroke={sketch} strokeWidth={detailWidth} />
          <Circle radius={2} fill={sketch} />
        </>
      )
    }

    if (obj.type === 'text') {
      return (
        <>
          <Rect
            x={-w / 2}
            y={-h / 2}
            width={w}
            height={h}
            fill={fill}
            opacity={selected ? 0.22 : 0}
            stroke={selected ? WALL_SELECTED : 'transparent'}
            strokeWidth={selected ? 2 : 0}
            cornerRadius={2}
          />
          <Text
            x={-w / 2 + 8}
            y={-h / 2 + 7}
            width={Math.max(10, w - 16)}
            height={Math.max(10, h - 14)}
            text={obj.label}
            fontSize={obj.font_size ?? getTextboxFontSize(w, h)}
            fill={sketch}
            align="left"
            verticalAlign="middle"
            wrap="word"
            ellipsis
            listening={false}
          />
        </>
      )
    }

    return (
      <Rect
        offsetX={w / 2} offsetY={h / 2}
        width={w} height={h}
        fill={fill}
        stroke={selectedStroke}
        strokeWidth={strokeWidth}
        cornerRadius={3}
      />
    )
  }

  const getResizeHandles = () => {
    const baseHandles: ResizeHandle[] = [
      ['nw', -obj.width / 2, -obj.height / 2, 0, 0],
      ['ne', obj.width / 2, -obj.height / 2, 0, 0],
      ['sw', -obj.width / 2, obj.height / 2, 0, 0],
      ['se', obj.width / 2, obj.height / 2, 0, 0],
    ]

    if (obj.type === 'stairs' && obj.stair_shape === 'return_landing') return []
    if (obj.type !== 'stairs' || obj.stair_shape !== 'landing') return baseHandles

    const w = obj.width
    const h = obj.height
    const landingW = Math.min(w * 0.42, Math.max(34, obj.landing_width ?? 80))
    const landingH = Math.min(h * 0.58, Math.max(34, obj.landing_depth ?? 80))
    const secondRunH = Math.max(28, (h - landingH) / 2)
    const landingX = w / 2 - landingW
    const landingY = -landingH / 2
    const turnRight = obj.landing_turn === 'right'
    const secondRunY = turnRight ? landingY + landingH : landingY - secondRunH
    const visualHandles: ResizeHandle[] = turnRight
      ? [
          ['nw', -w / 2, landingY, 0, landingY + h / 2],
          ['ne', w / 2, landingY, 0, landingY + h / 2],
          ['sw', landingX, secondRunY + secondRunH, landingX + w / 2, secondRunY + secondRunH - h / 2],
          ['se', w / 2, secondRunY + secondRunH, 0, secondRunY + secondRunH - h / 2],
        ]
      : [
          ['nw', landingX, secondRunY, landingX + w / 2, secondRunY + h / 2],
          ['ne', w / 2, secondRunY, 0, secondRunY + h / 2],
          ['sw', -w / 2, landingY + landingH, 0, landingY + landingH - h / 2],
          ['se', w / 2, landingY + landingH, 0, landingY + landingH - h / 2],
        ]

    return visualHandles
  }

  const resizeHandles = getResizeHandles()

  return (
    <Group
      x={obj.x} y={obj.y} rotation={obj.rotation}
      draggable={tool === 'select'}
      onClick={onSelect} onTap={onSelect}
      onContextMenu={(event) => {
        if (obj.type !== 'stairs') return
        event.evt.preventDefault()
        event.cancelBubble = true
        onStairContextMenu?.(event)
      }}
      onDblClick={(e) => {
        if (obj.type !== 'text') return
        stopKonvaBubble(e)
        onEditText?.()
      }}
      onDragStart={(e) => {
        if (e.target !== e.currentTarget) return
        pushHistory()
      }}
      onDragEnd={(e) => {
        if (e.target !== e.currentTarget) return
        const nx = snapTo(e.target.x(), SNAP_GRID)
        const ny = snapTo(e.target.y(), SNAP_GRID)
        onChange({ x: nx, y: ny })
        e.target.x(nx); e.target.y(ny)
      }}
    >
      {renderSymbol()}
      {selected && tool === 'select' && (
        <>
          {resizeHandles.map(([corner, x, y, offsetX, offsetY]) => (
            <Circle
              key={corner}
              x={x}
              y={y}
              radius={5}
              fill="#4f6ef7"
              stroke="#fff"
              strokeWidth={1}
              draggable
              onMouseDown={stopKonvaBubble}
              onDragStart={handleResizeStart}
              onDragMove={handleResize(corner, { x: offsetX, y: offsetY })}
              onDragEnd={handleResizeEnd}
            />
          ))}
          {obj.type === 'stairs' && obj.stair_shape === 'return_landing' && ([
            ['top', 0, -obj.height / 2],
            ['bottom', 0, obj.height / 2],
          ] as Array<[ResizeSide, number, number]>).map(([side, x, y]) => (
            <Circle
              key={`side-${side}`}
              x={x}
              y={y}
              radius={5}
              fill="#f59e0b"
              stroke="#fff"
              strokeWidth={1}
              draggable
              onMouseDown={stopKonvaBubble}
              onDragStart={handleResizeStart}
              onDragMove={handleSideResize(side)}
              onDragEnd={handleResizeEnd}
            />
          ))}
          <Circle
            x={0} y={-obj.height / 2 - 14}
            radius={8} fill="#4f6ef7" stroke="#fff" strokeWidth={1.5}
            draggable
            onMouseDown={stopKonvaBubble}
            onDragStart={(e) => {
              stopKonvaBubble(e)
              pushHistory()
            }}
            onDragMove={(e) => {
              stopKonvaBubble(e)
              const stage = e.target.getStage()!
              const ptr = stage.getPointerPosition()!
              const group = e.target.getParent()!
              const absPos = group.getAbsolutePosition()
              const ang = Math.atan2(ptr.y - absPos.y, ptr.x - absPos.x) * (180 / Math.PI) + 90
              onChange({ rotation: Math.round(ang / 5) * 5 })
              e.target.x(0); e.target.y(-obj.height / 2 - 14)
            }}
            onDragEnd={(e) => {
              stopKonvaBubble(e)
              e.target.x(0); e.target.y(-obj.height / 2 - 14)
            }}
          />
          <RotateHandleIcon x={0} y={-obj.height / 2 - 14} rotation={-obj.rotation} />
          {obj.type === 'stairs' && obj.stair_shape === 'landing' && (() => {
            const landingW = Math.min(obj.width * 0.42, Math.max(34, obj.landing_width ?? 80))
            const landingX = obj.landing_turn === 'right' ? -obj.width / 2 : obj.width / 2 - landingW
            const turnRight = obj.landing_turn === 'right'
            const handleX = landingX + landingW / 2
            const handleY = turnRight ? obj.height / 2 + 12 : -obj.height / 2 - 12
            return (
              <Circle
                x={handleX}
                y={handleY}
                radius={6}
                fill="#10b981"
                stroke="#fff"
                strokeWidth={1.5}
                draggable
                onMouseDown={stopKonvaBubble}
                onDragStart={handleLandingFlightResizeStart}
                onDragMove={handleLandingFlightResize}
                onDragEnd={(e) => {
                  handleLandingFlightResizeEnd(e)
                  e.target.x(handleX)
                  e.target.y(handleY)
                }}
              />
            )
          })()}
          {obj.type === 'stairs' && obj.stair_shape === 'return_landing' && (() => {
            const legacyLandingW = Math.min(obj.width * 0.34, Math.max(34, obj.landing_width ?? 80))
            const landingW = obj.landing_width ?? obj.landingWidth ?? legacyLandingW
            const runH = Math.min(Math.max(22, obj.landing_depth ?? 80), Math.max(22, (obj.height - 10) / 2))
            const landingX = obj.landing_turn === 'right' ? -obj.width / 2 : obj.width / 2 - landingW
            const handleX = landingX + landingW / 2
            const handleY = obj.height / 2 - runH
            return (
              <Circle
                x={handleX}
                y={handleY}
                radius={6}
                fill="#10b981"
                stroke="#fff"
                strokeWidth={1.5}
                draggable
                onMouseDown={stopKonvaBubble}
                onDragStart={handleLandingFlightResizeStart}
                onDragMove={handleReturnMiddleResize}
                onDragEnd={(e) => {
                  handleLandingFlightResizeEnd(e)
                  e.target.x(handleX)
                  e.target.y(handleY)
                }}
              />
            )
          })()}
          {obj.type === 'stairs' && obj.stair_shape === 'return_landing' && (() => {
            const runH = Math.min(Math.max(22, obj.landing_depth ?? 80), Math.max(22, (obj.height - 10) / 2))
            const mirrored = obj.landing_turn === 'right'
            const legacyLandingW = Math.min(obj.width * 0.34, Math.max(34, obj.landing_width ?? 80))
            const landingW = obj.landing_width ?? obj.landingWidth ?? legacyLandingW
            const legacyRunW = Math.max(12, obj.width - landingW)
            const leftRunWidth = obj.left_run_width ?? obj.leftRunWidth ?? legacyRunW
            const rightRunWidth = obj.right_run_width ?? obj.rightRunWidth ?? legacyRunW
            const landingJoinX = mirrored
              ? -obj.width / 2 + landingW
              : obj.width / 2 - landingW
            const upperY = -obj.height / 2 + runH / 2
            const lowerY = obj.height / 2 - runH / 2
            const handles: Array<{ run: 'left' | 'right'; x: number; y: number }> = [
              {
                run: 'right',
                x: mirrored ? landingJoinX + rightRunWidth : landingJoinX - rightRunWidth,
                y: upperY,
              },
              {
                run: 'left',
                x: mirrored ? landingJoinX + leftRunWidth : landingJoinX - leftRunWidth,
                y: lowerY,
              },
            ]

            return handles.map(({ run, x: handleX, y: handleY }) => (
              <Circle
                key={`return-run-length-${run}`}
                x={handleX}
                y={handleY}
                radius={6}
                fill="#2563eb"
                stroke="#fff"
                strokeWidth={1.5}
                draggable
                onMouseDown={stopKonvaBubble}
                onDragStart={handleLandingFlightResizeStart}
                onDragMove={handleReturnRunLengthResize(run)}
                onDragEnd={(e) => {
                  handleLandingFlightResizeEnd(e)
                  e.target.x(handleX)
                  e.target.y(handleY)
                }}
              />
            ))
          })()}
        </>
      )}
    </Group>
  )
}

// ─── Main Canvas ──────────────────────────────────────────────────────────────

interface Props { stageWidth: number; stageHeight: number }

type CanvasExportDetail = {
  pixelRatio?: number
  resolve: (image: { dataUrl: string; width: number; height: number }) => void
  reject: (error: Error) => void
}

export default function Canvas2D({ stageWidth, stageHeight }: Props) {
  const store = useFloorPlanStore()
  const { walls, openings, objects, activeTool, buildPreset, selectedId, grid_size, measurementUnit, wallMeasurementMode } = store

  const stageRef = useRef<Konva.Stage>(null)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)
  const [stairStart, setStairStart] = useState<{ x: number; y: number } | null>(null)
  const [stairCurrent, setStairCurrent] = useState<{ x: number; y: number } | null>(null)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })
  const [stageScale, setStageScale] = useState(1)
  const [isDraggingStage, setIsDraggingStage] = useState(false)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [editingTextValue, setEditingTextValue] = useState('')
  const [stairContextMenu, setStairContextMenu] = useState<{
    objectId: string
    x: number
    y: number
    planX: number
    planY: number
  } | null>(null)
  const [scrollbarDrag, setScrollbarDrag] = useState<{
    axis: 'x' | 'y'
    startClient: number
    currentClient: number
    startPos: { x: number; y: number }
  } | null>(null)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const spacePanPreviousTool = useRef<Tool | null>(null)
  const [doorPreview, setDoorPreview] = useState<{
    wall: Wall; offset: number; cx: number; cy: number
  } | null>(null)

  useEffect(() => {
    const stopStageDrag = () => {
      setIsDraggingStage(false)
      lastPos.current = null
    }
    window.addEventListener('mouseup', stopStageDrag)
    window.addEventListener('blur', stopStageDrag)
    return () => {
      window.removeEventListener('mouseup', stopStageDrag)
      window.removeEventListener('blur', stopStageDrag)
    }
  }, [])

  useEffect(() => {
    if (!scrollbarDrag) return

    const handlePointerMove = (e: PointerEvent) => {
      const client = scrollbarDrag.axis === 'x' ? e.clientX : e.clientY
      const delta = client - scrollbarDrag.startClient

      setScrollbarDrag(current => current ? { ...current, currentClient: client } : current)
      setStagePos(clampStagePos({
        x: scrollbarDrag.axis === 'x' ? scrollbarDrag.startPos.x - delta : scrollbarDrag.startPos.x,
        y: scrollbarDrag.axis === 'y' ? scrollbarDrag.startPos.y - delta : scrollbarDrag.startPos.y,
      }))
    }

    const stopScrollbarDrag = () => setScrollbarDrag(null)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopScrollbarDrag)
    window.addEventListener('pointercancel', stopScrollbarDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopScrollbarDrag)
      window.removeEventListener('pointercancel', stopScrollbarDrag)
    }
  }, [scrollbarDrag, stageWidth, stageHeight, stageScale, walls, objects])

  useEffect(() => {
    const handleExport = (event: Event) => {
      const customEvent = event as CustomEvent<CanvasExportDetail>
      const stage = stageRef.current
      if (!stage) {
        customEvent.detail.reject(new Error('2D canvas is not ready'))
        return
      }

      try {
        const pixelRatio = customEvent.detail.pixelRatio ?? 3
        customEvent.detail.resolve({
          dataUrl: stage.toDataURL({
            mimeType: 'image/jpeg',
            quality: 0.98,
            pixelRatio,
          }),
          width: stage.width() * pixelRatio,
          height: stage.height() * pixelRatio,
        })
      } catch (error) {
        customEvent.detail.reject(error instanceof Error ? error : new Error('Export failed'))
      }
    }

    window.addEventListener('homeplanner:export-2d', handleExport)
    return () => window.removeEventListener('homeplanner:export-2d', handleExport)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      return element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA'
    }
    const restoreSpacePanTool = () => {
      const previousTool = spacePanPreviousTool.current
      if (!previousTool) return
      store.setTool(previousTool)
      spacePanPreviousTool.current = null
    }
    const keydownHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (isTypingTarget(target)) return
      const key = e.key.toLowerCase()

      if (e.key === 'Escape') { store.setTool('select'); setDrawStart(null); setDrawCurrent(null); setStairStart(null); setStairCurrent(null) }
      if (selectedId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const selectedObject = objects.find(object => object.id === selectedId)
        if (selectedObject) {
          e.preventDefault()
          if (!e.repeat) store.pushHistory()
          const distance = e.shiftKey ? 10 : 1
          const deltaX = e.key === 'ArrowLeft' ? -distance : e.key === 'ArrowRight' ? distance : 0
          const deltaY = e.key === 'ArrowUp' ? -distance : e.key === 'ArrowDown' ? distance : 0
          store.updateObject(selectedObject.id, {
            x: selectedObject.x + deltaX,
            y: selectedObject.y + deltaY,
          })
          return
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        if (walls.find(w => w.id === selectedId)) store.removeWall(selectedId)
        else if (openings.find(o => o.id === selectedId)) store.removeOpening(selectedId)
        else store.removeObject(selectedId)
      }
      if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); store.undo(); return }
      if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); store.redo(); return }
      if (key === 'v') store.setTool('select')
      if (key === 'w') store.setTool('wall')
      if (key === 'd') store.setTool('door')
      if (key === 'b') store.setTool('doubleDoor')
      if (key === 's') store.setTool('stairs')
      if (key === 'g') store.setTool('gate')
      if (key === 'n') store.setTool('window')
      if (key === 'o') store.setTool('object')
      if (key === 't') store.setTool('text')
      if (key === 'x') store.setTool('delete')
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        if (!spacePanPreviousTool.current) {
          spacePanPreviousTool.current = useFloorPlanStore.getState().activeTool
        }
        store.setTool('pan')
      }
    }
    const keyupHandler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (e.code !== 'Space' && e.key !== ' ') return
      e.preventDefault()
      restoreSpacePanTool()
    }
    window.addEventListener('keydown', keydownHandler)
    window.addEventListener('keyup', keyupHandler)
    window.addEventListener('blur', restoreSpacePanTool)
    return () => {
      window.removeEventListener('keydown', keydownHandler)
      window.removeEventListener('keyup', keyupHandler)
      window.removeEventListener('blur', restoreSpacePanTool)
    }
  }, [selectedId, walls, openings, objects, store])

  const getStagePointer = () => {
    const stage = stageRef.current!
    const ptr = stage.getPointerPosition()!
    return {
      x: (ptr.x - stagePos.x) / stageScale,
      y: (ptr.y - stagePos.y) / stageScale,
    }
  }

  const getScrollableBounds = (scale = stageScale) => {
    const wallPoints = walls.flatMap((wall) => [wall.start, wall.end])
    const objectPoints = objects.flatMap((object) => [
      { x: object.x - object.width / 2, y: object.y - object.height / 2 },
      { x: object.x + object.width / 2, y: object.y + object.height / 2 },
    ])
    const points = [...wallPoints, ...objectPoints]
    const fallback = [
      { x: 0, y: 0 },
      { x: stageWidth / scale, y: stageHeight / scale },
    ]
    const source = points.length ? points : fallback
    const padding = 260
    const minX = Math.min(...source.map((point) => point.x)) - padding
    const maxX = Math.max(...source.map((point) => point.x)) + padding
    const minY = Math.min(...source.map((point) => point.y)) - padding
    const maxY = Math.max(...source.map((point) => point.y)) + padding
    const minStageX = Math.min(stageWidth - maxX * scale, -minX * scale)
    const maxStageX = Math.max(stageWidth - maxX * scale, -minX * scale)
    const minStageY = Math.min(stageHeight - maxY * scale, -minY * scale)
    const maxStageY = Math.max(stageHeight - maxY * scale, -minY * scale)

    return { minStageX, maxStageX, minStageY, maxStageY }
  }

  const clampStagePos = (
    pos: { x: number; y: number },
    scale = stageScale,
  ) => {
    const bounds = getScrollableBounds(scale)
    return {
      x: Math.max(bounds.minStageX, Math.min(bounds.maxStageX, pos.x)),
      y: Math.max(bounds.minStageY, Math.min(bounds.maxStageY, pos.y)),
    }
  }

  const findClosestWall = (x: number, y: number, maxDist = 30) => {
    let best: { wall: Wall; offset: number; dist: number; cx: number; cy: number } | null = null
    for (const w of walls) {
      const proj = projectOntoWall(x, y, w)
      if (proj && proj.dist < maxDist && (!best || proj.dist < best.dist)) {
        best = { wall: w, ...proj }
      }
    }
    return best
  }

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    if (!e.evt.ctrlKey && !e.evt.metaKey) {
      const scrollSpeed = 1.1
      const horizontalDelta = e.evt.shiftKey ? e.evt.deltaY : e.evt.deltaX
      const verticalDelta = e.evt.shiftKey ? 0 : e.evt.deltaY
      setStagePos((pos) => clampStagePos({
        x: pos.x - horizontalDelta * scrollSpeed,
        y: pos.y - verticalDelta * scrollSpeed,
      }))
      return
    }

    const scaleBy = 1.08
    const stage = stageRef.current!
    const pointer = stage.getPointerPosition()!
    const oldScale = stageScale
    const newScale = Math.max(0.3, Math.min(4, e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy))
    const mousePointTo = { x: (pointer.x - stagePos.x) / oldScale, y: (pointer.y - stagePos.y) / oldScale }
    setStageScale(newScale)
    setStagePos(clampStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale }, newScale))
  }

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const shouldPan = e.evt.button === 1 || e.evt.button === 2 || e.evt.altKey
    if (shouldPan) {
      e.evt.preventDefault()
      setIsDraggingStage(true)
      lastPos.current = { x: e.evt.clientX, y: e.evt.clientY }
      return
    }
    const raw = getStagePointer()

    if (activeTool === 'wall') {
      // Step 1: snap candidate (endpoint snap + grid snap)
      let snapped = snapToWallGeometry(raw.x, raw.y, walls)

      if (!drawStart) {
        // Merge with any nearby existing point so chained walls share exact refs
        const merged = mergeWithExistingPoints(snapped, walls)
        setDrawStart(merged)
        setDrawCurrent(merged)
      } else {
        // Step 2: optional orthogonal lock
        if (e.evt.shiftKey) {
          const dx = snapped.x - drawStart.x
          const dy = snapped.y - drawStart.y
          if (Math.abs(dx) > Math.abs(dy)) snapped.y = drawStart.y
          else snapped.x = drawStart.x
        }

        // Step 3: merge end with any existing nearby endpoint
        const mergedEnd = mergeWithExistingPoints(snapped, walls)

        const len = Math.hypot(mergedEnd.x - drawStart.x, mergedEnd.y - drawStart.y)
        if (len > 10) {
          store.addWall({
            start: drawStart,
            end: mergedEnd,
            thickness: buildPreset?.includes('half-wall') ? 14 : buildPreset?.includes('foundation') ? 18 : 10,
            height: buildPreset?.includes('half-wall') ? 1.1 : buildPreset?.includes('pony') ? 1.5 : 2.8,
            wall_type: buildPreset ?? 'straight-exterior-wall',
            curved: buildPreset?.includes('curved') ?? false,
            color: buildPreset?.includes('glass') ? '#8fd3e8' : undefined,
          })
        }

        // Continue chaining from the merged end point
        setDrawStart(mergedEnd)
        setDrawCurrent(mergedEnd)
      }
    }

    if (activeTool === 'door' || activeTool === 'doubleDoor' || activeTool === 'gate' || activeTool === 'window') {
      const hit = findClosestWall(raw.x, raw.y)
      if (hit) {
        const isGate = activeTool === 'gate'
        const isDoor = activeTool === 'door' || activeTool === 'doubleDoor' || isGate
        const doorStyle = buildPreset === 'doorway'
          ? 'opening'
          : buildPreset === 'sliding-door'
            ? 'sliding'
            : buildPreset === 'pocket-door'
              ? 'pocket'
              : buildPreset === 'bifold-door'
                ? 'bifold'
                : buildPreset === 'garage-door'
                  ? 'garage'
                  : buildPreset === 'fixed-door'
                    ? 'fixed'
                    : buildPreset === 'barn-door'
                      ? 'barn'
                      : buildPreset === 'shower-door'
                        ? 'shower'
                        : activeTool === 'doubleDoor' || isGate
                          ? 'double'
                          : 'hinged'
        const windowStyle = buildPreset === 'bay-window'
          ? 'bay'
          : buildPreset === 'bow-window'
            ? 'bow'
            : buildPreset === 'box-window'
              ? 'garden'
              : buildPreset === 'pass-through'
                ? 'picture'
                : buildPreset === 'wall-niche'
                  ? 'fixed'
                  : 'double_hung'
        store.addOpening({
          wall_id: hit.wall.id,
          type: isGate ? 'gate' : isDoor ? 'door' : 'window',
          offset: hit.offset,
          width: buildPreset === 'garage-door' ? 140 : activeTool === 'doubleDoor' ? 100 : activeTool === 'gate' ? 90 : activeTool === 'door' ? 40 : buildPreset === 'bay-window' || buildPreset === 'bow-window' ? 70 : 40,
          swing: 'left',
          height: isDoor ? 2.1 : undefined,
          elevation: isDoor ? 0 : undefined,
          trim: isDoor ? 0.08 : undefined,
          door_style: isDoor ? doorStyle : undefined,
          mount: isDoor ? 'center' : undefined,
          swing_direction: isDoor ? 'in' : undefined,
          swing_angle: isDoor ? 90 : undefined,
          handle_style: isDoor ? 'knob' : undefined,
          frame_color: isDoor ? '#111827' : undefined,
          panel_color: isDoor ? '#ffffff' : undefined,
          window_style: !isDoor ? windowStyle : undefined,
          build_variant: buildPreset ?? undefined,
        })
        store.setTool('select')
        store.setBuildPreset(null)
        setDoorPreview(null)
      }
    }

    if (activeTool === 'stairs') {
      let snapped = { x: snapTo(raw.x, SNAP_GRID), y: snapTo(raw.y, SNAP_GRID) }

      if (!stairStart) {
        setStairStart(snapped)
        setStairCurrent(snapped)
      } else {
        if (e.evt.shiftKey) {
          const dx = snapped.x - stairStart.x
          const dy = snapped.y - stairStart.y
          if (Math.abs(dx) > Math.abs(dy)) snapped.y = stairStart.y
          else snapped.x = stairStart.x
        }

        const length = Math.hypot(snapped.x - stairStart.x, snapped.y - stairStart.y)
        if (length > 20) {
          store.addObject({
            type: 'stairs',
            label: 'Stairs',
            x: (stairStart.x + snapped.x) / 2,
            y: (stairStart.y + snapped.y) / 2,
            width: length,
            height: 80,
            rotation: Math.atan2(snapped.y - stairStart.y, snapped.x - stairStart.x) * 180 / Math.PI,
            color: '#8f969c',
            stair_shape: buildPreset === 'l-shaped-stair'
              ? 'landing'
              : buildPreset === 'u-shaped-stair'
                ? 'return_landing'
                : 'straight',
            stair_height: 2.8,
            stair_steps: 12,
            build_variant: buildPreset ?? 'draw-stairs',
          })
        }
        setStairStart(null)
        setStairCurrent(null)
        store.setTool('select')
        store.setBuildPreset(null)
      }
    }
  }

  const handleMouseUp = () => {
    if (!isDraggingStage) return
    setIsDraggingStage(false)
    lastPos.current = null
  }

  const handleDblClick = () => {
    if (activeTool === 'wall') { setDrawStart(null); setDrawCurrent(null) }
    if (activeTool === 'stairs') { setStairStart(null); setStairCurrent(null) }
  }

  const startTextEdit = (obj: PlacedObject, recordHistory = true) => {
    if (recordHistory) store.pushHistory()
    store.setSelected(obj.id)
    setEditingTextId(obj.id)
    setEditingTextValue(obj.label)
  }

  const finishTextEdit = () => {
    if (!editingTextId) return
    const obj = objects.find(o => o.id === editingTextId)
    if (obj) {
      store.updateObject(obj.id, { label: editingTextValue.trim() || 'Text' })
    }
    setEditingTextId(null)
    setEditingTextValue('')
    store.setSelected(null)
  }

  const cancelTextEdit = () => {
    setEditingTextId(null)
    setEditingTextValue('')
    store.setSelected(null)
  }

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const isCanvasTarget = e.target === e.target.getStage() || e.target.name() === 'grid-bg'
    if (!isCanvasTarget) return

    if (activeTool === 'text') {
      const raw = getStagePointer()
      const obj = store.addObject({
        type: 'text',
        label: 'Text',
        x: snapTo(raw.x, SNAP_GRID),
        y: snapTo(raw.y, SNAP_GRID),
        width: 140,
        height: 44,
        rotation: 0,
        color: '#111827',
      })
      store.setTool('select')
      startTextEdit(obj, false)
      return
    }

    if (editingTextId) finishTextEdit()
    store.setSelected(null)
  }

  const moveConnectedWallEndpoint = (
    connected: ConnectedWallEndpoint[],
    next: { x: number; y: number }
  ) => {
    const byWall = new Map<string, Partial<Wall>>()
    connected.forEach(({ wallId, endpoint }) => {
      byWall.set(wallId, { ...byWall.get(wallId), [endpoint]: next })
    })
    byWall.forEach((updates, wallId) => store.updateWall(wallId, updates))
  }

  const moveConnectedWallBody = (
    connected: WallBodyConnection[],
    dx: number,
    dy: number
  ) => {
    const byWall = new Map<string, Partial<Wall>>()
    connected.forEach(({ wallId, endpoint, point }) => {
      byWall.set(wallId, {
        ...byWall.get(wallId),
        [endpoint]: { x: point.x + dx, y: point.y + dy },
      })
    })
    byWall.forEach((updates, wallId) => store.updateWall(wallId, updates))
  }

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isDraggingStage && lastPos.current) {
      setStagePos(p => clampStagePos({
        x: p.x + e.evt.clientX - lastPos.current!.x,
        y: p.y + e.evt.clientY - lastPos.current!.y,
      }))
      lastPos.current = { x: e.evt.clientX, y: e.evt.clientY }
      return
    }

    const raw = getStagePointer()

    if (activeTool === 'door' || activeTool === 'doubleDoor' || activeTool === 'gate' || activeTool === 'window') {
      const hit = findClosestWall(raw.x, raw.y)
      setDoorPreview(hit ? { wall: hit.wall, offset: hit.offset, cx: hit.cx, cy: hit.cy } : null)
    } else {
      setDoorPreview(null)
    }

    if (activeTool === 'wall' && drawStart) {
      let snapped = snapToWallGeometry(raw.x, raw.y, walls)

      if (e.evt.shiftKey) {
        const dx = snapped.x - drawStart.x
        const dy = snapped.y - drawStart.y
        if (Math.abs(dx) > Math.abs(dy)) snapped.y = drawStart.y
        else snapped.x = drawStart.x
      }

      // Also snap preview to nearby endpoints after orthogonal lock
      snapped = snapToWallGeometry(snapped.x, snapped.y, walls)

      setDrawCurrent(snapped)
    }

    if (activeTool === 'stairs' && stairStart) {
      let snapped = { x: snapTo(raw.x, SNAP_GRID), y: snapTo(raw.y, SNAP_GRID) }

      if (e.evt.shiftKey) {
        const dx = snapped.x - stairStart.x
        const dy = snapped.y - stairStart.y
        if (Math.abs(dx) > Math.abs(dy)) snapped.y = stairStart.y
        else snapped.x = stairStart.x
      }

      setStairCurrent(snapped)
    }
  }

  const showGrid = false

  useEffect(() => {
    if (!stairContextMenu) return
    const close = () => setStairContextMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [stairContextMenu])

  const changeStairType = (
    stairShape: NonNullable<PlacedObject['stair_shape']>,
    landingTurn?: NonNullable<PlacedObject['landing_turn']>,
  ) => {
    if (!stairContextMenu) return
    const stair = objects.find(object => object.id === stairContextMenu.objectId)
    const legacyLandingWidth = stair
      ? Math.min(stair.width * 0.34, Math.max(34, stair.landing_width ?? 80))
      : 80
    const legacyRunWidth = stair ? Math.max(12, stair.width - legacyLandingWidth) : 80
    store.pushHistory()
    store.updateObject(stairContextMenu.objectId, {
      stair_shape: stairShape,
      ...(landingTurn ? { landing_turn: landingTurn } : {}),
      ...(stairShape === 'straight'
        ? {}
        : {
          landing_width: objects.find(object => object.id === stairContextMenu.objectId)?.landing_width ?? 80,
          landing_depth: objects.find(object => object.id === stairContextMenu.objectId)?.landing_depth ?? 80,
          ...(stairShape === 'return_landing'
            ? {
              landing_width: stair?.landing_width ?? stair?.landingWidth ?? legacyLandingWidth,
              left_run_width: stair?.left_run_width ?? stair?.leftRunWidth ?? legacyRunWidth,
              right_run_width: stair?.right_run_width ?? stair?.rightRunWidth ?? legacyRunWidth,
            }
            : {}),
        }),
    })
    store.setSelected(stairContextMenu.objectId)
    setStairContextMenu(null)
  }

  const getConnectedStairLanding = (stair: PlacedObject): {
    other: PlacedObject
    firstEnd: { sign: -1 | 1; x: number; y: number }
    secondEnd: { sign: -1 | 1; x: number; y: number }
    distance: number
  } | null => {
    const stairAngle = (stair.rotation * Math.PI) / 180
    const stairEnds = ([-1, 1] as const).map(sign => ({
      sign,
      x: stair.x + Math.cos(stairAngle) * stair.width / 2 * sign,
      y: stair.y + Math.sin(stairAngle) * stair.width / 2 * sign,
    }))
    const contextAlong = stairContextMenu
      ? (stairContextMenu.planX - stair.x) * Math.cos(stairAngle)
        + (stairContextMenu.planY - stair.y) * Math.sin(stairAngle)
      : stair.width / 2
    const preferredEnd = stairEnds.reduce((closest, end) => (
      Math.abs(contextAlong - end.sign * stair.width / 2)
        < Math.abs(contextAlong - closest.sign * stair.width / 2)
        ? end
        : closest
    ))

    let best: {
      other: PlacedObject
      firstEnd: (typeof stairEnds)[number]
      secondEnd: { sign: -1 | 1; x: number; y: number }
      distance: number
    } | null = null

    objects.forEach(other => {
      if (other.id === stair.id || other.type !== 'stairs' || (other.stair_shape ?? 'straight') !== 'straight') return
      const angleDifference = Math.abs((((other.rotation - stair.rotation) % 180) + 180) % 180)
      const parallelDifference = Math.min(angleDifference, 180 - angleDifference)
      if (parallelDifference > 12) return

      const otherAngle = (other.rotation * Math.PI) / 180
      const otherEnds = ([-1, 1] as const).map(sign => ({
        sign,
        x: other.x + Math.cos(otherAngle) * other.width / 2 * sign,
        y: other.y + Math.sin(otherAngle) * other.width / 2 * sign,
      }))

      otherEnds.forEach(secondEnd => {
        const distance = Math.hypot(secondEnd.x - preferredEnd.x, secondEnd.y - preferredEnd.y)
        const maximumConnectionDistance = Math.max(320, stair.height + other.height + 160)
        if (distance > maximumConnectionDistance || (best && distance >= best.distance)) return
        best = { other, firstEnd: preferredEnd, secondEnd, distance }
      })
    })

    return best as {
      other: PlacedObject
      firstEnd: { sign: -1 | 1; x: number; y: number }
      secondEnd: { sign: -1 | 1; x: number; y: number }
      distance: number
    } | null
  }

  const addLandingBetweenStairs = () => {
    if (!stairContextMenu) return
    const stair = objects.find(object => object.id === stairContextMenu.objectId)
    if (!stair) return
    const connection = getConnectedStairLanding(stair)
    if (!connection) return

    const { other, firstEnd, secondEnd } = connection
    const angle = (stair.rotation * Math.PI) / 180
    const axisX = Math.cos(angle)
    const axisY = Math.sin(angle)
    const crossX = -axisY
    const crossY = axisX
    const outwardSign = firstEnd.sign
    const firstEndAlong = firstEnd.x * axisX + firstEnd.y * axisY
    const secondEndAlong = secondEnd.x * axisX + secondEnd.y * axisY
    const firstAcross = stair.x * crossX + stair.y * crossY
    const secondAcross = other.x * crossX + other.y * crossY
    const connectionAlong = (firstEndAlong + secondEndAlong) / 2
    const firstShift = connectionAlong - firstEndAlong
    const secondShift = connectionAlong - secondEndAlong
    const overlap = 3
    const landingDepth = Math.max(40, Math.min(120, Math.max(stair.height, other.height)))
    const minimumAcross = Math.min(firstAcross - stair.height / 2, secondAcross - other.height / 2) - overlap
    const maximumAcross = Math.max(firstAcross + stair.height / 2, secondAcross + other.height / 2) + overlap
    const landingWidth = maximumAcross - minimumAcross
    const landingAcross = (minimumAcross + maximumAcross) / 2
    const landingAlong = connectionAlong + outwardSign * (landingDepth / 2 - overlap)
    const landing = {
      type: 'landing',
      label: 'Landing',
      x: axisX * landingAlong + crossX * landingAcross,
      y: axisY * landingAlong + crossY * landingAcross,
      width: landingWidth,
      height: landingDepth,
      rotation: stair.rotation + 90,
      color: '#d7b17d',
      elevation: firstEnd.sign > 0 ? (stair.stair_height ?? 2.8) : 0,
      build_variant: 'connected-stair-landing',
    }

    store.pushHistory()
    store.updateObject(stair.id, {
      x: stair.x + axisX * firstShift,
      y: stair.y + axisY * firstShift,
    })
    store.updateObject(other.id, {
      x: other.x + axisX * secondShift,
      y: other.y + axisY * secondShift,
      ...(secondEnd.sign === firstEnd.sign
        ? {}
        : { rotation: (other.rotation + 180) % 360 }),
    })
    const created = store.addObject(landing)
    store.setSelected(created.id)
    setStairContextMenu(null)
  }

  const gridLines = () => {
    const lines: React.ReactNode[] = []
    const startX = Math.floor(-stagePos.x / stageScale / grid_size) * grid_size - grid_size * 2
    const startY = Math.floor(-stagePos.y / stageScale / grid_size) * grid_size - grid_size * 2
    const endX = startX + stageWidth / stageScale + grid_size * 4
    const endY = startY + stageHeight / stageScale + grid_size * 4
    for (let x = startX; x < endX; x += grid_size) {
      const major = x % (grid_size * 5) === 0
      lines.push(<Line key={`v${x}`} points={[x, startY, x, endY]} stroke={major ? '#d1d5db' : '#e5e7eb'} strokeWidth={major ? 0.8 : 0.4} listening={false} />)
    }
    for (let y = startY; y < endY; y += grid_size) {
      const major = y % (grid_size * 5) === 0
      lines.push(<Line key={`h${y}`} points={[startX, y, endX, y]} stroke={major ? '#d1d5db' : '#e5e7eb'} strokeWidth={major ? 0.8 : 0.4} listening={false} />)
    }
    return lines
  }

  const cursor = activeTool === 'wall' ? 'crosshair'
    : (activeTool === 'door' || activeTool === 'doubleDoor' || activeTool === 'gate' || activeTool === 'window') ? 'cell'
    : activeTool === 'stairs' ? 'crosshair'
    : activeTool === 'text' ? 'text'
    : activeTool === 'pan' ? (isDraggingStage ? 'grabbing' : 'grab')
    : activeTool === 'delete' ? 'not-allowed'
    : 'default'
  const scrollBounds = getScrollableBounds()
  const scrollMinX = Math.round(scrollBounds.minStageX)
  const scrollMaxX = Math.round(scrollBounds.maxStageX)
  const scrollMinY = Math.round(scrollBounds.minStageY)
  const scrollMaxY = Math.round(scrollBounds.maxStageY)
  const editingText = editingTextId ? objects.find(o => o.id === editingTextId && o.type === 'text') : null
  const getScrollbarThumbStyle = (axis: 'x' | 'y'): CSSProperties => {
    const trackLength = axis === 'x' ? Math.max(80, stageWidth - 42) : Math.max(80, stageHeight - 42)
    const min = axis === 'x' ? scrollBounds.minStageX : scrollBounds.minStageY
    const max = axis === 'x' ? scrollBounds.maxStageX : scrollBounds.maxStageY
    const value = axis === 'x' ? stagePos.x : stagePos.y
    const range = Math.max(0, max - min)
    const thumbLength = range <= 0
      ? trackLength
      : Math.max(44, Math.min(trackLength * 0.65, (trackLength * trackLength) / (trackLength + range)))
    const travel = Math.max(1, trackLength - thumbLength)
    const baseOffset = range <= 0 ? 0 : ((max - value) / range) * travel
    const dragOffset = scrollbarDrag?.axis === axis
      ? scrollbarDrag.currentClient - scrollbarDrag.startClient
      : 0
    const offset = Math.max(0, Math.min(travel, baseOffset + dragOffset))

    return axis === 'x'
      ? { width: thumbLength, transform: `translateX(${offset}px)` }
      : { height: thumbLength, transform: `translateY(${offset}px)` }
  }

  return (
    <div
      className="canvas-viewport"
      style={{ width: stageWidth, height: stageHeight, cursor, userSelect: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={stageWidth} height={stageHeight}
        x={stagePos.x} y={stagePos.y}
        scaleX={stageScale} scaleY={stageScale}
        draggable={activeTool === 'pan'}
        onDragStart={(e) => {
          if (e.target !== stageRef.current) return
          setIsDraggingStage(true)
        }}
        onDragMove={(e) => {
          if (e.target !== stageRef.current) return
          const nextPos = clampStagePos({ x: e.target.x(), y: e.target.y() })
          e.target.x(nextPos.x)
          e.target.y(nextPos.y)
          setStagePos(nextPos)
        }}
        onDragEnd={(e) => {
          if (e.target !== stageRef.current) return
          const nextPos = clampStagePos({ x: e.target.x(), y: e.target.y() })
          e.target.x(nextPos.x)
          e.target.y(nextPos.y)
          setStagePos(nextPos)
          setIsDraggingStage(false)
          lastPos.current = null
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={handleDblClick}
        onClick={handleStageClick}
      >
        {/* Grid */}
        <Layer listening={false}>
          <Rect name="grid-bg" x={-5000} y={-5000} width={10000} height={10000} fill="#f5f5f5" />
          {showGrid && gridLines()}
        </Layer>

        {/* Furniture */}
        <Layer>
          {objects.map(obj => (
            <FurnitureShape
              key={obj.id} obj={obj}
              selected={selectedId === obj.id}
              tool={activeTool}
              onSelect={() => {
                if (activeTool === 'delete') { store.removeObject(obj.id); return }
                if (activeTool === 'select') store.setSelected(obj.id)
              }}
              onChange={u => store.updateObject(obj.id, u)}
              onEditText={() => startTextEdit(obj)}
              onStairContextMenu={(event) => {
                const planPoint = pointerWorldPosition(event.target.getStage()!)
                store.setSelected(obj.id)
                setStairContextMenu({
                  objectId: obj.id,
                  x: event.evt.clientX,
                  y: event.evt.clientY,
                  planX: planPoint?.x ?? obj.x,
                  planY: planPoint?.y ?? obj.y,
                })
              }}
            />
          ))}
        </Layer>

        {/* Walls + openings */}
        <Layer>
          {walls.map(wall => (
            <WallShape
              key={`${wall.id}-outline`} wall={wall}
              openings={openings}
              selected={selectedId === wall.id}
              tool={activeTool}
              onSelect={() => {
                if (activeTool === 'delete') { store.removeWall(wall.id); return }
                if (activeTool === 'select') store.setSelected(wall.id)
              }}
              onChange={u => store.updateWall(wall.id, u)}
              onEndpointDrag={moveConnectedWallEndpoint}
              onWallBodyDrag={moveConnectedWallBody}
              allWalls={walls}
              measurementUnit={measurementUnit}
              wallMeasurementMode={wallMeasurementMode}
              renderPass="outline"
            />
          ))}
          {walls.map(wall => (
            <WallShape
              key={`${wall.id}-fill`} wall={wall}
              openings={openings}
              selected={selectedId === wall.id}
              tool={activeTool}
              onSelect={() => {
                if (activeTool === 'delete') { store.removeWall(wall.id); return }
                if (activeTool === 'select') store.setSelected(wall.id)
              }}
              onChange={u => store.updateWall(wall.id, u)}
              onEndpointDrag={moveConnectedWallEndpoint}
              onWallBodyDrag={moveConnectedWallBody}
              allWalls={walls}
              measurementUnit={measurementUnit}
              wallMeasurementMode={wallMeasurementMode}
              renderPass="fill"
            />
          ))}
          {walls.map(wall => (
            <WallShape
              key={`${wall.id}-details`} wall={wall}
              openings={openings}
              selected={selectedId === wall.id}
              tool={activeTool}
              onSelect={() => {
                if (activeTool === 'delete') { store.removeWall(wall.id); return }
                if (activeTool === 'select') store.setSelected(wall.id)
              }}
              onChange={u => store.updateWall(wall.id, u)}
              onEndpointDrag={moveConnectedWallEndpoint}
              onWallBodyDrag={moveConnectedWallBody}
              allWalls={walls}
              measurementUnit={measurementUnit}
              wallMeasurementMode={wallMeasurementMode}
              renderPass="details"
            />
          ))}

          {openings.map(o => {
            const wall = walls.find(w => w.id === o.wall_id)
            if (!wall) return null
            if (o.type === 'door' || o.type === 'gate') return (
              <DoorShape
                key={o.id} wall={wall} opening={o}
                selected={selectedId === o.id}
                onSelect={() => {
                  if (activeTool === 'delete') { store.removeOpening(o.id); return }
                  store.setSelected(o.id)
                }}
                onDelete={() => store.removeOpening(o.id)}
                onChange={(u) => store.updateOpening(o.id,u)}
              />
            )
            return (
              <WindowShape
                key={o.id} wall={wall} opening={o}
                selected={selectedId === o.id}
                onSelect={() => {
                  if (activeTool === 'delete') { store.removeOpening(o.id); return }
                  store.setSelected(o.id)
                }}
                onDelete={() => store.removeOpening(o.id)}
                onChange={(u) => store.updateOpening(o.id,u)}
              />
            )
          })}

          {/* Door/window placement preview */}
          {doorPreview && (activeTool === 'door' || activeTool === 'doubleDoor' || activeTool === 'gate' || activeTool === 'window') && (
            <Circle
              x={doorPreview.cx} y={doorPreview.cy}
              radius={activeTool === 'doubleDoor' ? 65 : activeTool === 'gate' ? 45 : activeTool === 'door' ? 40 : 30}
              stroke={activeTool === 'door' || activeTool === 'doubleDoor' || activeTool === 'gate' ? DOOR_COLOR : WINDOW_COLOR}
              strokeWidth={1.5}
              fill={activeTool === 'door' || activeTool === 'doubleDoor' || activeTool === 'gate' ? 'rgba(245,158,11,0.15)' : 'rgba(56,189,248,0.15)'}
              dash={[4, 3]}
              listening={false}
            />
          )}

          {/* Alignment guide lines */}
          {drawStart && guides.x !== undefined && (
            <Line points={[guides.x, -5000, guides.x, 5000]}
              stroke="#4f6ef7" strokeWidth={0.5} dash={[6, 4]} opacity={0.5} listening={false} />
          )}
          {drawStart && guides.y !== undefined && (
            <Line points={[-5000, guides.y, 5000, guides.y]}
              stroke="#4f6ef7" strokeWidth={0.5} dash={[6, 4]} opacity={0.5} listening={false} />
          )}

          {/* Ghost wall while drawing */}
          {activeTool === 'wall' && drawStart && drawCurrent && (
            <Group>
              <Line
                points={[drawStart.x, drawStart.y, drawCurrent.x, drawCurrent.y]}
                stroke="#4f6ef7" strokeWidth={10} opacity={0.5}
                lineCap="round" listening={false}
              />
              <Circle x={drawStart.x} y={drawStart.y} radius={5} fill="#4f6ef7" listening={false} />
              <Circle x={drawCurrent.x} y={drawCurrent.y} radius={5} fill="#4f6ef7" listening={false} />
              <Text
                x={(drawStart.x + drawCurrent.x) / 2 + 6}
                y={(drawStart.y + drawCurrent.y) / 2 - 16}
                text={formatLength(Math.hypot(drawCurrent.x - drawStart.x, drawCurrent.y - drawStart.y), measurementUnit)}
                fill="#4f6ef7" fontSize={12} listening={false}
              />
            </Group>
          )}

          {/* Ghost stairs while drawing */}
          {activeTool === 'stairs' && stairStart && stairCurrent && (
            (() => {
              const previewRotation = Math.atan2(stairCurrent.y - stairStart.y, stairCurrent.x - stairStart.x) * 180 / Math.PI
              return (
            <Group
              x={(stairStart.x + stairCurrent.x) / 2}
              y={(stairStart.y + stairCurrent.y) / 2}
              rotation={previewRotation}
              listening={false}
            >
              {(() => {
                const w = Math.max(20, Math.hypot(stairCurrent.x - stairStart.x, stairCurrent.y - stairStart.y))
                const h = 80
                const inset = 8
                const treadCount = Math.max(4, Math.round(w / 16))
                return (
                  <>
                    <Rect offsetX={w / 2} offsetY={h / 2} width={w} height={h} fill="#ffffff" opacity={0.72} stroke="#111827" strokeWidth={1.6} dash={[5, 4]} />
                    <Line points={[-w / 2 + inset, -h / 2, -w / 2 + inset, h / 2]} stroke="#111827" strokeWidth={1.1} opacity={0.75} />
                    <Line points={[w / 2 - inset, -h / 2, w / 2 - inset, h / 2]} stroke="#111827" strokeWidth={1.1} opacity={0.75} />
                    {Array.from({ length: treadCount + 1 }).map((_, i) => {
                      const x = -w / 2 + inset + ((w - inset * 2) / treadCount) * i
                      return <Line key={i} points={[x, -h / 2, x, h / 2]} stroke="#111827" strokeWidth={1} opacity={0.55} />
                    })}
                    <Arrow points={[-w / 2 + inset + 4, 0, w / 2 - inset - 4, 0]} stroke="#111827" fill="#111827" strokeWidth={1.3} pointerLength={5} pointerWidth={5} />
                    <Text x={w / 2 - 26} y={-14} text="UP" fontSize={9} fontStyle="bold" fill="#111827" />
                  </>
                )
              })()}
            </Group>
              )
            })()
          )}
        </Layer>
      </Stage>

      {editingText && (
        <textarea
          className="canvas-text-editor"
          value={editingTextValue}
          autoFocus
          style={{
            left: stagePos.x + editingText.x * stageScale,
            top: stagePos.y + editingText.y * stageScale,
            width: Math.max(48, editingText.width * stageScale),
            height: Math.max(28, editingText.height * stageScale),
            fontSize: Math.max(7, getTextboxFontSize(editingText.width, editingText.height) * stageScale),
            padding: Math.max(4, 7 * stageScale),
            transform: `translate(-50%, -50%) rotate(${editingText.rotation}deg)`,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setEditingTextValue(e.target.value)}
          onBlur={finishTextEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              finishTextEdit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              cancelTextEdit()
            }
          }}
        />
      )}

      {stairContextMenu && (
        <div
          className="fixed z-[100] min-w-52 overflow-hidden rounded-lg border border-gray-300 bg-white py-1.5 text-sm text-gray-800 shadow-2xl"
          style={{ left: stairContextMenu.x, top: stairContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="border-b border-gray-200 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Stair Type
          </div>
          {(() => {
            const stair = objects.find(object => object.id === stairContextMenu.objectId)
            const canAddLanding = stair
              && (stair.stair_shape ?? 'straight') === 'straight'
              && Boolean(getConnectedStairLanding(stair))
            return (
              <button
                type="button"
                disabled={!canAddLanding}
                className={`flex w-full items-center gap-2 border-b border-gray-200 px-3 py-2 text-left font-medium transition-colors ${
                  canAddLanding
                    ? 'text-amber-700 hover:bg-amber-50'
                    : 'cursor-not-allowed text-gray-400'
                }`}
                onClick={addLandingBetweenStairs}
              >
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Add landing between stairs
              </button>
            )
          })()}
          {([
            ['straight', undefined, 'Straight / Regular'],
            ['landing', 'left', 'Landing — Left'],
            ['landing', 'right', 'Landing — Right'],
            ['return_landing', 'left', 'Opposite Landing — Left'],
            ['return_landing', 'right', 'Opposite Landing — Right'],
          ] as Array<[
            NonNullable<PlacedObject['stair_shape']>,
            NonNullable<PlacedObject['landing_turn']> | undefined,
            string,
          ]>).map(([shape, turn, label]) => {
            const stair = objects.find(object => object.id === stairContextMenu.objectId)
            const active = stair?.stair_shape === shape
              && (shape === 'straight' || (stair.landing_turn ?? 'left') === turn)
            return (
              <button
                key={`${shape}-${turn ?? 'none'}`}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-900 hover:text-white'
                }`}
                onClick={() => changeStairType(shape, turn)}
              >
                <span className={`h-2 w-2 rounded-full ${active ? 'bg-white' : 'bg-gray-400'}`} />
                {label}
              </button>
            )
          })}
        </div>
      )}

      <div
        className="canvas-scrollbar canvas-scrollbar-x"
        role="scrollbar"
        aria-label="Scroll 2D plan left and right"
        aria-valuemin={scrollMinX}
        aria-valuemax={scrollMaxX}
        aria-valuenow={Math.round(stagePos.x)}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          setScrollbarDrag({ axis: 'x', startClient: e.clientX, currentClient: e.clientX, startPos: stagePos })
        }}
      >
        <div
          className="canvas-scrollbar-thumb"
          style={getScrollbarThumbStyle('x')}
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            setScrollbarDrag({ axis: 'x', startClient: e.clientX, currentClient: e.clientX, startPos: stagePos })
          }}
        />
      </div>
      <div
        className="canvas-scrollbar canvas-scrollbar-y"
        style={{ height: Math.max(80, stageHeight - 42) }}
        role="scrollbar"
        aria-label="Scroll 2D plan up and down"
        aria-orientation="vertical"
        aria-valuemin={scrollMinY}
        aria-valuemax={scrollMaxY}
        aria-valuenow={Math.round(stagePos.y)}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          setScrollbarDrag({ axis: 'y', startClient: e.clientY, currentClient: e.clientY, startPos: stagePos })
        }}
      >
        <div
          className="canvas-scrollbar-thumb"
          style={getScrollbarThumbStyle('y')}
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            setScrollbarDrag({ axis: 'y', startClient: e.clientY, currentClient: e.clientY, startPos: stagePos })
          }}
        />
      </div>

      {(activeTool === 'door' || activeTool === 'doubleDoor' || activeTool === 'gate' || activeTool === 'window') && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-gray-900/90 text-xs text-gray-300 px-3 py-1.5 rounded-full border border-gray-700 pointer-events-none">
          Click on a wall to place {activeTool === 'doubleDoor' ? 'a double door' : activeTool === 'gate' ? 'a gate' : activeTool === 'door' ? 'a door' : 'a window'}
          {!doorPreview && walls.length === 0 && ' — draw walls first'}
        </div>
      )}

      {activeTool === 'wall' && drawStart && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-gray-900/90 text-xs text-gray-300 px-3 py-1.5 rounded-full border border-gray-700 pointer-events-none">
          Hold <kbd className="bg-gray-700 px-1 rounded">Shift</kbd> for straight walls
        </div>
      )}

      {activeTool === 'text' && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-gray-900/90 text-xs text-gray-300 px-3 py-1.5 rounded-full border border-gray-700 pointer-events-none">
          Click the plan to place text - Double-click placed text to edit
        </div>
      )}

      {activeTool === 'stairs' && stairStart && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-gray-900/90 text-xs text-gray-300 px-3 py-1.5 rounded-full border border-gray-700 pointer-events-none">
          Click to finish stairs - Hold <kbd className="bg-gray-700 px-1 rounded">Shift</kbd> for straight stairs
        </div>
      )}
    </div>
  )
}
