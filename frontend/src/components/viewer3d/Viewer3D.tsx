import { useRef, useMemo, useEffect, useState, Suspense } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useFloorPlanStore } from '../../store/useFloorPlanStore'
import type { Wall, Opening, PlacedObject } from '../../types/schema'

const PX = 0.02  // 50px = 1 metre
const DEFAULT_OUTER_WALL_COLOR = '#9db2bd'
const DEFAULT_INNER_WALL_COLOR = '#eee8dc'
const WALL_TOP_COLOR = '#ead9b8'
const FLOOR_EDGE_COLOR = '#ad7a3d'

type VideoRecordDetail = {
  filename?: string
  durationMs?: number
  saveBlob?: (blob: Blob, filename: string) => Promise<void>
  resolve?: () => void
  reject?: (error: Error) => void
}

type RecordingState = {
  startTime: number
  durationMs: number
  target: THREE.Vector3
  radius: number
  topRadius: number
  height: number
  topHeight: number
  recorder: MediaRecorder
  stopped: boolean
}

type DragState =
  | {
    type: 'object'
    id: string
    pointerId: number
    offsetX: number
    offsetZ: number
  }
  | {
    type: 'opening'
    id: string
    wallId: string
    pointerId: number
  }
  | {
    type: 'wall-endpoint'
    id: string
    endpoint: 'start' | 'end'
    pointerId: number
  }
  | {
    type: 'wall-height'
    id: string
    pointerId: number
    startHeight: number
    startClientY: number
  }
  | {
    type: 'opening-resize'
    id: string
    wallId: string
    pointerId: number
  }
  | {
    type: 'opening-height'
    id: string
    pointerId: number
    startHeight: number
    startClientY: number
  }
  | {
    type: 'object-resize'
    id: string
    pointerId: number
    corner: ResizeCorner
    start: {
      x: number
      y: number
      width: number
      height: number
      rotation: number
    }
  }
  | {
    type: 'return-stair-resize'
    id: string
    pointerId: number
    part: ReturnStairPart
    start: {
      x: number
      y: number
      width: number
      rotation: number
      landingWidth: number
      leftRunWidth: number
      rightRunWidth: number
      mirrored: boolean
    }
  }

type EditablePointerHandler = (event: ThreeEvent<PointerEvent>) => void
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'
type ReturnStairPart = 'landing' | 'left' | 'right'
type WindowStyle = NonNullable<Opening['window_style']>

const WINDOW_STYLE_OPTIONS: Array<{ value: WindowStyle; label: string }> = [
  { value: 'awning', label: 'Awning' },
  { value: 'bay', label: 'Bay' },
  { value: 'bow', label: 'Bow' },
  { value: 'casement', label: 'Casement' },
  { value: 'cottage', label: 'Cottage' },
  { value: 'center_pivot', label: 'Pivot' },
  { value: 'dormer', label: 'Dormer' },
  { value: 'double_hung', label: 'Double-hung' },
  { value: 'egress', label: 'Egress' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'french', label: 'French' },
  { value: 'garden', label: 'Garden' },
  { value: 'hopper', label: 'Hopper' },
  { value: 'glass_block', label: 'Glass block' },
  { value: 'jalousie', label: 'Jalousie' },
  { value: 'lunette', label: 'Lunette' },
  { value: 'oriel', label: 'Oriel' },
  { value: 'palladian', label: 'Palladian' },
  { value: 'picture', label: 'Picture' },
  { value: 'radius', label: 'Radius' },
  { value: 'round', label: 'Round' },
  { value: 'single_hung', label: 'Single-hung' },
  { value: 'skylight', label: 'Skylight' },
  { value: 'storm', label: 'Storm' },
  { value: 'three_panel_slider', label: '3-panel slider' },
  { value: 'tilt_turn', label: 'Tilt-turn' },
  { value: 'transom', label: 'Transom' },
  { value: 'two_panel_slider', label: '2-panel slider' },
]

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const groundPoint = new THREE.Vector3()

function snapTo(value: number, grid: number) {
  return Math.round(value / grid) * grid
}

function roundTo(value: number, step: number) {
  return Math.round(value / step) * step
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getGroundPoint(event: ThreeEvent<PointerEvent>) {
  return event.ray.intersectPlane(groundPlane, groundPoint)
}

function projectPointToWallOffset(pointX: number, pointZ: number, wall: Wall, openingWidth = 0) {
  const startX = wall.start.x * PX
  const startZ = wall.start.y * PX
  const endX = wall.end.x * PX
  const endZ = wall.end.y * PX
  const dx = endX - startX
  const dz = endZ - startZ
  const lenSq = dx * dx + dz * dz
  if (lenSq === 0) return 0.5

  const raw = ((pointX - startX) * dx + (pointZ - startZ) * dz) / lenSq
  const wallPxLength = Math.sqrt(lenSq) / PX
  const margin = wallPxLength > 0 ? Math.min(0.45, (openingWidth / 2) / wallPxLength) : 0
  return Math.max(margin, Math.min(1 - margin, raw))
}

function projectPointAlongWall(pointX: number, pointZ: number, wall: Wall) {
  const startX = wall.start.x * PX
  const startZ = wall.start.y * PX
  const angle = wallAngle(wall)
  return (pointX - startX) * Math.cos(angle) + (pointZ - startZ) * Math.sin(angle)
}

function openingCenter(wall: Wall, opening: Opening) {
  return {
    x: (wall.start.x + (wall.end.x - wall.start.x) * opening.offset) * PX,
    z: (wall.start.y + (wall.end.y - wall.start.y) * opening.offset) * PX,
  }
}

function createWoodFloorTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#c9904f'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const plankHeight = 42
  for (let y = 0; y < canvas.height; y += plankHeight) {
    const hueShift = (y / plankHeight) % 3
    ctx.fillStyle = hueShift === 0 ? '#d4a05f' : hueShift === 1 ? '#bd8546' : '#d8aa70'
    ctx.fillRect(0, y, canvas.width, plankHeight - 2)
    ctx.strokeStyle = 'rgba(95, 61, 28, 0.24)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, y + plankHeight - 1)
    ctx.lineTo(canvas.width, y + plankHeight - 1)
    ctx.stroke()

    const stagger = ((y / plankHeight) % 2) * 128
    for (let x = -stagger; x < canvas.width; x += 170) {
      ctx.strokeStyle = 'rgba(75, 47, 22, 0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, y + 3)
      ctx.lineTo(x, y + plankHeight - 5)
      ctx.stroke()
    }

    for (let grain = 0; grain < 9; grain += 1) {
      const gy = y + 7 + grain * 3.4
      ctx.strokeStyle = `rgba(80, 49, 24, ${0.055 + (grain % 3) * 0.02})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, gy)
      for (let x = 0; x <= canvas.width; x += 32) {
        ctx.lineTo(x, gy + Math.sin((x + y + grain * 13) / 34) * 1.8)
      }
      ctx.stroke()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function hexToRgb(color: string) {
  const match = color.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  const toHex = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return { h: 0, s: 0, l }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h / 6, s, l }
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }) {
  if (s === 0) {
    const gray = l * 255
    return { r: gray, g: gray, b: gray }
  }

  const hueToRgb = (p: number, q: number, t: number) => {
    let next = t
    if (next < 0) next += 1
    if (next > 1) next -= 1
    if (next < 1 / 6) return p + (q - p) * 6 * next
    if (next < 1 / 2) return q
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hueToRgb(p, q, h + 1 / 3) * 255,
    g: hueToRgb(p, q, h) * 255,
    b: hueToRgb(p, q, h - 1 / 3) * 255,
  }
}

function mixRgb(
  from: { r: number; g: number; b: number },
  to: { r: number; g: number; b: number },
  amount: number,
) {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  }
}

function premiumWallColor(color: string | undefined, outer = false) {
  const fallback = outer ? DEFAULT_OUTER_WALL_COLOR : DEFAULT_INNER_WALL_COLOR
  if (!color) return fallback

  const rgb = hexToRgb(color)
  if (!rgb) return color

  const hsl = rgbToHsl(rgb)
  hsl.s = hsl.s < 0.02 ? 0 : Math.min(hsl.s * 0.94, outer ? 0.72 : 0.68)
  hsl.l = outer
    ? clamp(hsl.l + 0.03, 0.28, 0.92)
    : clamp(hsl.l + 0.05, 0.32, 0.96)

  const premium = hslToRgb(hsl)
  const surface = hexToRgb(outer ? '#eef3f2' : '#fffaf2')!
  return rgbToHex(mixRgb(premium, surface, outer ? 0.06 : 0.08))
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function wallLength(w: Wall) {
  return Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y)
}

function wallAngle(w: Wall) {
  return Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x)
}

function getWallBounds(walls: Wall[]) {
  const xs = walls.flatMap(w => [w.start.x, w.end.x])
  const ys = walls.flatMap(w => [w.start.y, w.end.y])
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

function isOuterWall(wall: Wall, bounds: ReturnType<typeof getWallBounds>) {
  const tolerance = Math.max(12, wall.thickness * 1.5)
  const vertical = Math.abs(wall.start.x - wall.end.x) < Math.abs(wall.start.y - wall.end.y)
  const horizontal = !vertical

  if (vertical) {
    const x = (wall.start.x + wall.end.x) / 2
    return Math.abs(x - bounds.minX) <= tolerance || Math.abs(x - bounds.maxX) <= tolerance
  }

  if (horizontal) {
    const y = (wall.start.y + wall.end.y) / 2
    return Math.abs(y - bounds.minY) <= tolerance || Math.abs(y - bounds.maxY) <= tolerance
  }

  return false
}

function wallEndpointExtension(
  wall: Wall,
  endpoint: 'start' | 'end',
  allWalls: Wall[],
) {
  const point = wall[endpoint]
  const tolerance = Math.max(1, wall.thickness * 0.12)
  const currentAngle = wallAngle(wall)

  const connected = allWalls.filter(candidate => {
    if (candidate.id === wall.id) return false
    const endpointDistance = Math.min(
      Math.hypot(candidate.start.x - point.x, candidate.start.y - point.y),
      Math.hypot(candidate.end.x - point.x, candidate.end.y - point.y),
    )
    if (endpointDistance <= tolerance) return true

    // Also recognize a T-junction where this endpoint lands on the body of
    // another wall rather than on one of its endpoints.
    const dx = candidate.end.x - candidate.start.x
    const dy = candidate.end.y - candidate.start.y
    const lengthSq = dx * dx + dy * dy
    if (lengthSq === 0) return false
    const offset = (
      (point.x - candidate.start.x) * dx
      + (point.y - candidate.start.y) * dy
    ) / lengthSq
    if (offset <= 0.01 || offset >= 0.99) return false
    const projectedX = candidate.start.x + dx * offset
    const projectedY = candidate.start.y + dy * offset
    const bodyTolerance = Math.max(tolerance, candidate.thickness * 0.6)
    return Math.hypot(point.x - projectedX, point.y - projectedY) <= bodyTolerance
  })

  if (connected.length === 0) return 0

  // Collinear walls already meet cleanly at their shared center-line endpoint.
  // Only angled joins need overlap to close the outside corner.
  const angled = connected.filter(candidate => {
    const delta = Math.abs(Math.sin(wallAngle(candidate) - currentAngle))
    return delta > 0.08
  })
  if (angled.length === 0) return 0

  // Extend only enough to meet the widest connected wall face. This prevents
  // isolated ends and straight joins from growing visible wall tails.
  const connectedHalfThickness = Math.max(
    ...angled.map(candidate => Math.max(candidate.thickness * PX, 0.08) / 2),
  )
  return connectedHalfThickness
}

// Build wall geometry with opening cuts as separate box meshes
// Returns array of {x, z, length, angle, yOffset, height} segments
function buildWallSegments(
  wall: Wall,
  openings: Opening[],
  renderHeight = wall.height,
  allWalls: Wall[] = [wall],
) {
  const len = wallLength(wall)
  const angle = wallAngle(wall)
  const height = renderHeight
  const thick = Math.max(wall.thickness * PX, 0.08)

  const wallOpenings = openings
    .flatMap(opening => {
      if (opening.wall_id === wall.id) return [opening]

      const sourceWall = allWalls.find(candidate => candidate.id === opening.wall_id)
      if (!sourceWall) return []

      const sourceAngle = wallAngle(sourceWall)
      const parallelDelta = Math.abs(Math.sin(sourceAngle - angle))
      if (parallelDelta > 0.02) return []

      const center = openingCenter(sourceWall, opening)
      const targetStartX = wall.start.x * PX
      const targetStartZ = wall.start.y * PX
      const targetEndX = wall.end.x * PX
      const targetEndZ = wall.end.y * PX
      const targetDx = targetEndX - targetStartX
      const targetDz = targetEndZ - targetStartZ
      const targetLengthSq = targetDx * targetDx + targetDz * targetDz
      if (targetLengthSq === 0) return []

      const targetOffset = (
        (center.x - targetStartX) * targetDx
        + (center.z - targetStartZ) * targetDz
      ) / targetLengthSq
      if (targetOffset < 0 || targetOffset > 1) return []

      const projectedX = targetStartX + targetDx * targetOffset
      const projectedZ = targetStartZ + targetDz * targetOffset
      const distanceToTarget = Math.hypot(center.x - projectedX, center.z - projectedZ)
      const overlapTolerance = Math.max(wall.thickness, sourceWall.thickness) * PX
      if (distanceToTarget > overlapTolerance) return []

      return [{ ...opening, offset: targetOffset }]
    })
    .sort((a, b) => a.offset - b.offset)

  // Each segment: [t_start, t_end] along wall 0..1
  // Each opening creates a gap AND potentially above-door segment (for windows)
  const segments: Array<{
    t0: number; t1: number;
    yBottom: number; yTop: number;
  }> = []

  if (wallOpenings.length === 0) {
    segments.push({ t0: 0, t1: 1, yBottom: 0, yTop: height })
  } else {
    let cursor = 0
    for (const o of wallOpenings) {
      // Cut slightly behind the visible frame so wall faces cannot bleed into
      // the aperture at oblique camera angles.
      const openingClearancePx = o.type === 'window' ? 5 : 0
      const halfT = (o.width / 2 + openingClearancePx) / len
      const t0 = Math.max(0, o.offset - halfT)
      const t1 = Math.min(1, o.offset + halfT)

      // Segment before opening
      if (cursor < t0) {
        segments.push({ t0: cursor, t1: t0, yBottom: 0, yTop: height })
      }

      // For windows: add segment below and above
      if (o.type === 'window') {
        const winBottom = o.elevation ?? 0.9
        const winH = Math.min(o.height ?? o.width * PX * 1.2, height - winBottom - 0.1)
        const winTop = winBottom + winH
        const verticalClearance = 0.1
        const cutBottom = Math.max(0, winBottom - verticalClearance)
        const cutTop = Math.min(height, winTop + verticalClearance)
        if (cutBottom > 0) {
          segments.push({ t0, t1, yBottom: 0, yTop: cutBottom })
        }
        if (cutTop < height) {
          segments.push({ t0, t1, yBottom: cutTop, yTop: height })
        }
      }
      // Gates cut fully through the wall height.
      if (o.type === 'gate') {
        cursor = t1
        continue
      }
      // Door: only lintel above if door is shorter than wall
      // (standard door is 2.1m, wall is 2.8m)
      if (o.type === 'door') {
        const doorBottom = o.elevation ?? 0
        const doorH = Math.min(o.height ?? 2.1, height - doorBottom - 0.1)
        if (doorBottom > 0) {
          segments.push({ t0, t1, yBottom: 0, yTop: doorBottom })
        }
        if (doorBottom + doorH < height) {
          segments.push({ t0, t1, yBottom: doorBottom + doorH, yTop: height })
        }
      }

      cursor = t1
    }
    if (cursor < 1) {
      segments.push({ t0: cursor, t1: 1, yBottom: 0, yTop: height })
    }
  }

  // Convert segments to 3D mesh params. End segments get square-cap extension
  // so 3D corners match the clean 2D wall rendering.
  return segments.map(({ t0, t1, yBottom, yTop }) => {
    const baseLen = (t1 - t0) * len * PX
    const startExtend = t0 === 0 ? wallEndpointExtension(wall, 'start', allWalls) : 0
    const endExtend = t1 === 1 ? wallEndpointExtension(wall, 'end', allWalls) : 0
    const segLen = baseLen + startExtend + endExtend
    const midT = (t0 + t1) / 2
    const alongX = Math.cos(angle)
    const alongZ = Math.sin(angle)
    const capOffset = (endExtend - startExtend) / 2
    const cx = (wall.start.x + (wall.end.x - wall.start.x) * midT) * PX + alongX * capOffset
    const cz = (wall.start.y + (wall.end.y - wall.start.y) * midT) * PX + alongZ * capOffset
    const segH = yTop - yBottom
    const cy = yBottom + segH / 2
    return {
      cx,
      cy,
      cz,
      segLen,
      segH,
      thick,
      angle,
      isWallTop: Math.abs(yTop - height) < 0.001,
    }
  })
}

// ─── Wall3D ──────────────────────────────────────────────────────────────────

function WallSegmentMesh({ segment, color, selected }: {
  segment: ReturnType<typeof buildWallSegments>[number]
  color: string
  selected?: boolean
}) {
  return (
    <group
      position={[segment.cx, segment.cy, segment.cz]}
      rotation={[0, -segment.angle, 0]}
    >
      <mesh>
        <boxGeometry args={[segment.segLen, segment.segH, segment.thick]} />
        <meshStandardMaterial
          color={color}
          emissive={selected ? '#2563eb' : '#000000'}
          emissiveIntensity={selected ? 0.12 : 0}
          roughness={0.96}
          metalness={0}
        />
      </mesh>
      {segment.isWallTop && (
        <mesh position={[0, segment.segH / 2 + 0.006, 0]}>
          <boxGeometry args={[segment.segLen + 0.012, 0.012, segment.thick + 0.018]} />
          <meshStandardMaterial color={WALL_TOP_COLOR} roughness={0.82} metalness={0} />
        </mesh>
      )}
    </group>
  )
}

function Wall3D({ wall, walls, openings, renderHeight, outer, selected, onPointerDown }: {
  wall: Wall
  walls: Wall[]
  openings: Opening[]
  renderHeight?: number
  outer?: boolean
  selected?: boolean
  onPointerDown?: EditablePointerHandler
}) {
  const openingSignature = openings
    .filter(o => o.wall_id === wall.id)
    .map(o => [
      o.id,
      o.offset,
      o.type,
      o.width,
      o.height,
      o.elevation,
      o.trim,
      o.door_style,
      o.swing_angle,
    ].join(':'))
    .join('|')

  const segments = useMemo(() => buildWallSegments(wall, openings, renderHeight, walls), [
    wall.start.x, wall.start.y, wall.end.x, wall.end.y,
    wall.thickness, wall.height, renderHeight,
    walls, openings,
    openingSignature,
  ])
  const wallColor = premiumWallColor(wall.color, outer)

  return (
    <group onPointerDown={onPointerDown}>
      {segments.map((s, i) => {
        if (s.segLen < 0.01) return null
        return (
          <WallSegmentMesh
            key={i}
            segment={s}
            color={wallColor}
            selected={selected}
          />
        )
      })}
    </group>
  )
}

// ─── Door frame 3D ───────────────────────────────────────────────────────────

function DoorFrame3D({ wall, opening, selected, onPointerDown }: {
  wall: Wall
  opening: Opening
  selected?: boolean
  onPointerDown?: EditablePointerHandler
}) {
  const angle = opening.rotation !== undefined ? (opening.rotation * Math.PI) / 180 : wallAngle(wall)
  const len = wallLength(wall)
  const thick = Math.max(wall.thickness * PX, 0.12)
  const doorW = opening.width * PX
  const doorH = opening.height ?? 2.1
  const elevation = opening.elevation ?? 0
  const trim = opening.trim ?? 0.08
  const frameColor = selected ? '#2563eb' : '#f8f4ec'
  const panelColor = opening.panel_color ?? '#ffffff'
  const swingAngle = opening.swing_angle ?? 90
  const doorOpen = opening.door_open ?? true
  const doorStyle = opening.door_style ?? 'hinged'
  const mount = opening.mount ?? 'center'
  const mountOffset = mount === 'interior' ? -thick / 2 : mount === 'exterior' ? thick / 2 : 0

  const cx = (wall.start.x + (wall.end.x - wall.start.x) * opening.offset) * PX
  const cz = (wall.start.y + (wall.end.y - wall.start.y) * opening.offset) * PX

  const frameThick = 0.05
  const frameDepth = thick + 0.02

  return (
    <group position={[cx, elevation, cz]} rotation={[0, -angle, 0]} onPointerDown={onPointerDown}>
      {/* Left jamb */}
      <mesh position={[-(doorW / 2 + trim / 2), doorH / 2, mountOffset]}>
        <boxGeometry args={[trim, doorH + trim, frameDepth]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} />
      </mesh>
      {/* Right jamb */}
      <mesh position={[doorW / 2 + trim / 2, doorH / 2, mountOffset]}>
        <boxGeometry args={[trim, doorH + trim, frameDepth]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} />
      </mesh>
      {/* Top header */}
      <mesh position={[0, doorH + trim / 2, mountOffset]}>
        <boxGeometry args={[doorW + trim * 2, trim, frameDepth]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} />
      </mesh>
      {doorStyle !== 'opening' && (
        <DoorLeaf3D
          doorW={doorW}
          doorH={doorH}
          frameDepth={frameDepth}
          swing={opening.swing}
          swingDirection={opening.swing_direction ?? 'in'}
          swingAngle={doorStyle === 'sliding' || doorStyle === 'pocket' || doorStyle === 'barn' || doorStyle === 'garage' || doorStyle === 'fixed' || doorStyle === 'shower' || !doorOpen ? 0 : swingAngle}
          panelColor={panelColor}
          doorStyle={doorStyle}
          handleStyle={opening.handle_style ?? 'knob'}
          mountOffset={mountOffset}
        />
      )}
    </group>
  )
}

function DoorLeaf3D({ doorW, doorH, frameDepth, swing, swingDirection, swingAngle, panelColor, doorStyle, handleStyle, mountOffset }: {
  doorW: number; doorH: number; frameDepth: number; swing: string; swingDirection: string; swingAngle: number; panelColor: string; doorStyle: string; handleStyle: string; mountOffset: number
}) {
  const openAngle = -(swingAngle * Math.PI) / 180
  const directionMult = swingDirection === 'out' ? -1 : 1
  const panelCount = doorStyle === 'double' ? 2 : 1
  const leafDepth = 0.045
  const leafZ = -frameDepth / 4
  const hardwareColor = '#8b7355'

  if (doorStyle === 'sliding') {
    return (
      <group position={[0, 0, mountOffset]}>
        <mesh position={[-doorW / 4, doorH / 2, leafZ - 0.025]}>
          <boxGeometry args={[doorW / 2 - 0.012, doorH, leafDepth]} />
          <meshStandardMaterial color={panelColor} roughness={0.6} metalness={0.05} />
        </mesh>
        <mesh position={[doorW / 4, doorH / 2, leafZ + 0.025]}>
          <boxGeometry args={[doorW / 2 - 0.012, doorH, leafDepth]} />
          <meshStandardMaterial color={panelColor} roughness={0.6} metalness={0.05} />
        </mesh>
        <mesh position={[0, doorH + 0.055, leafZ]}>
          <boxGeometry args={[doorW + 0.12, 0.045, 0.06]} />
          <meshStandardMaterial color={hardwareColor} metalness={0.65} roughness={0.3} />
        </mesh>
      </group>
    )
  }

  if (doorStyle === 'pocket') {
    return (
      <group position={[0, 0, mountOffset]}>
        <mesh position={[doorW * 0.22, doorH / 2, leafZ]}>
          <boxGeometry args={[doorW * 0.55, doorH, leafDepth]} />
          <meshStandardMaterial color={panelColor} roughness={0.62} metalness={0.03} />
        </mesh>
        <mesh position={[-doorW * 0.38, doorH / 2, leafZ]}>
          <boxGeometry args={[0.035, doorH, frameDepth * 0.72]} />
          <meshStandardMaterial color="#c8c2b8" roughness={0.8} />
        </mesh>
      </group>
    )
  }

  if (doorStyle === 'barn') {
    return (
      <group position={[0, 0, mountOffset]}>
        <mesh position={[doorW * 0.22, doorH / 2, leafZ - frameDepth * 0.32]}>
          <boxGeometry args={[doorW * 0.92, doorH, 0.065]} />
          <meshStandardMaterial color={panelColor} roughness={0.72} metalness={0} />
        </mesh>
        <mesh position={[0, doorH + 0.1, leafZ - frameDepth * 0.32]}>
          <boxGeometry args={[doorW * 1.45, 0.055, 0.065]} />
          <meshStandardMaterial color="#3f3f3f" metalness={0.72} roughness={0.28} />
        </mesh>
        {[-0.22, 0.22].map((x, index) => (
          <mesh key={`barn-wheel-${index}`} position={[x * doorW, doorH + 0.04, leafZ - frameDepth * 0.36]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.055, 0.055, 0.025, 18]} />
            <meshStandardMaterial color="#292929" metalness={0.75} roughness={0.24} />
          </mesh>
        ))}
      </group>
    )
  }

  if (doorStyle === 'bifold') {
    const foldAngle = 0.5
    const sectionW = doorW / 4
    return (
      <group position={[0, 0, mountOffset]}>
        {[-1.5, -0.5, 0.5, 1.5].map((part, index) => (
          <mesh
            key={`bifold-${index}`}
            position={[part * sectionW, doorH / 2, leafZ + (index % 2 === 0 ? -0.06 : 0.06)]}
            rotation={[0, index % 2 === 0 ? foldAngle : -foldAngle, 0]}
          >
            <boxGeometry args={[sectionW - 0.018, doorH, leafDepth]} />
            <meshStandardMaterial color={panelColor} roughness={0.62} metalness={0.03} />
          </mesh>
        ))}
      </group>
    )
  }

  if (doorStyle === 'garage') {
    const sectionCount = 5
    return (
      <group position={[0, 0, mountOffset]}>
        {Array.from({ length: sectionCount }).map((_, index) => {
          const sectionH = doorH / sectionCount
          return (
            <mesh key={`garage-section-${index}`} position={[0, sectionH * (index + 0.5), leafZ]}>
              <boxGeometry args={[doorW - 0.025, sectionH - 0.018, 0.06]} />
              <meshStandardMaterial color={panelColor} roughness={0.68} metalness={0.04} />
            </mesh>
          )
        })}
        {[-0.28, 0.28].map((x, index) => (
          <mesh key={`garage-rail-${index}`} position={[x * doorW, doorH / 2, leafZ - 0.04]}>
            <boxGeometry args={[0.028, doorH, 0.025]} />
            <meshStandardMaterial color={hardwareColor} metalness={0.65} roughness={0.3} />
          </mesh>
        ))}
      </group>
    )
  }

  if (doorStyle === 'fixed') {
    return (
      <group position={[0, 0, mountOffset]}>
        <mesh position={[0, doorH / 2, leafZ]}>
          <boxGeometry args={[doorW - 0.015, doorH, 0.055]} />
          <meshStandardMaterial color={panelColor} roughness={0.62} metalness={0.02} />
        </mesh>
      </group>
    )
  }

  if (doorStyle === 'shower') {
    return (
      <group position={[0, 0, mountOffset]}>
        <mesh position={[0, doorH / 2, leafZ]}>
          <boxGeometry args={[doorW - 0.035, doorH, 0.025]} />
          <meshStandardMaterial
            color="#bfe8f2"
            transparent
            opacity={0.28}
            depthWrite={false}
            roughness={0.12}
            metalness={0.08}
          />
        </mesh>
        {[-1, 1].map(side => (
          <mesh key={`shower-edge-${side}`} position={[side * doorW * 0.49, doorH / 2, leafZ]}>
            <boxGeometry args={[0.035, doorH, 0.04]} />
            <meshStandardMaterial color="#aeb8c2" metalness={0.72} roughness={0.25} />
          </mesh>
        ))}
        <mesh position={[doorW * 0.3, doorH * 0.5, leafZ - 0.045]}>
          <boxGeometry args={[0.025, 0.32, 0.025]} />
          <meshStandardMaterial color="#aeb8c2" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>
    )
  }

  return (
    <>
      {Array.from({ length: panelCount }).map((_, index) => {
        const isDoubleRight = panelCount === 2 && index === 1
        const side = panelCount === 2 ? (isDoubleRight ? 1 : -1) : (swing === 'left' ? -1 : 1)
        const leafW = panelCount === 2 ? doorW / 2 : doorW
        const localHingeX = side * doorW / 2
        const leafDir = side < 0 ? 1 : -1
        return (
          <group key={index} position={[localHingeX, 0, mountOffset]} rotation={[0, openAngle * leafDir * directionMult, 0]}>
            <mesh position={[leafDir * leafW / 2, doorH / 2, -frameDepth / 4]}>
              <boxGeometry args={[leafW - 0.01, doorH, 0.04]} />
              <meshStandardMaterial color={panelColor} roughness={0.6} metalness={0.05} />
            </mesh>
            {handleStyle !== 'none' && (
              <mesh position={[leafDir * leafW * 0.78, doorH * 0.5, -frameDepth / 4 - 0.03]}>
                {handleStyle === 'bar'
                  ? <boxGeometry args={[0.025, 0.32, 0.025]} />
                  : <sphereGeometry args={[handleStyle === 'lever' ? 0.018 : 0.025, 8, 8]} />}
                <meshStandardMaterial color="#b0a080" metalness={0.8} roughness={0.2} />
              </mesh>
            )}
          </group>
        )
      })}
    </>
  )
}

// ─── Window frame 3D ─────────────────────────────────────────────────────────

function Gate3D({ wall, opening, selected, onPointerDown }: {
  wall: Wall
  opening: Opening
  selected?: boolean
  onPointerDown?: EditablePointerHandler
}) {
  const angle = opening.rotation !== undefined ? (opening.rotation * Math.PI) / 180 : wallAngle(wall)
  const thick = Math.max(wall.thickness * PX, 0.12)
  const gateW = opening.width * PX
  const gateH = opening.height ?? 1.45
  const frameColor = selected ? '#2563eb' : (opening.frame_color ?? '#111827')
  const cx = (wall.start.x + (wall.end.x - wall.start.x) * opening.offset) * PX
  const cz = (wall.start.y + (wall.end.y - wall.start.y) * opening.offset) * PX
  const depth = thick + 0.04
  const barCount = Math.max(10, Math.round(gateW / 0.12))

  const part = (
    key: string,
    position: [number, number, number],
    size: [number, number, number],
    rotation: [number, number, number] = [0, 0, 0]
  ) => (
    <mesh key={key} position={position} rotation={rotation}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={frameColor} roughness={0.55} metalness={0.18} />
    </mesh>
  )

  return (
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]} onPointerDown={onPointerDown}>
      {part('left-post', [-gateW / 2, gateH / 2, 0], [0.05, gateH, depth])}
      {part('right-post', [gateW / 2, gateH / 2, 0], [0.05, gateH, depth])}
      {part('bottom-rail', [0, 0.08, 0], [gateW, 0.045, depth])}
      {part('center-post', [0, gateH / 2, 0], [0.035, gateH * 0.92, depth])}
      {part('left-top-rail', [-gateW * 0.25, gateH - 0.08, 0], [gateW * 0.5, 0.035, depth], [0, 0, -0.14])}
      {part('right-top-rail', [gateW * 0.25, gateH - 0.08, 0], [gateW * 0.5, 0.035, depth], [0, 0, 0.14])}
      {Array.from({ length: barCount + 1 }).map((_, i) => {
        const x = -gateW / 2 + (gateW / barCount) * i
        const edgeFactor = Math.abs(x / (gateW / 2))
        const h = gateH * (0.74 + edgeFactor * 0.12)
        return part(`bar-${i}`, [x, h / 2 + 0.08, 0], [0.018, h, depth * 0.55])
      })}
      {[-gateW * 0.24, gateW * 0.24].map((x, i) => (
        <group key={`ornament-${i}`} position={[x, gateH * 0.48, -depth / 2 - 0.01]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <torusGeometry args={[0.105, 0.008, 8, 28]} />
            <meshStandardMaterial color={frameColor} roughness={0.45} metalness={0.25} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.06, 0.006, 8, 24]} />
            <meshStandardMaterial color={frameColor} roughness={0.45} metalness={0.25} />
          </mesh>
        </group>
      ))}
      {[-gateW * 0.07, gateW * 0.07].map((x, i) => (
        <mesh key={`knob-${i}`} position={[x, gateH * 0.55, -depth / 2 - 0.025]}>
          <sphereGeometry args={[0.025, 10, 10]} />
          <meshStandardMaterial color="#b0a080" roughness={0.2} metalness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

function WindowFrame3D({ wall, opening, selected, onPointerDown }: {
  wall: Wall
  opening: Opening
  selected?: boolean
  onPointerDown?: EditablePointerHandler
}) {
  const angle = wallAngle(wall)
  const thick = Math.max(wall.thickness * PX, 0.12)
  const winW = opening.width * PX
  const winBottom = opening.elevation ?? 0.9
  const winH = opening.height ?? winW * 1.2
  const winMidY = winBottom + winH / 2

  const cx = (wall.start.x + (wall.end.x - wall.start.x) * opening.offset) * PX
  const cz = (wall.start.y + (wall.end.y - wall.start.y) * opening.offset) * PX

  const frameT = Math.max(0.065, Math.min(0.11, winW * 0.065))
  const sashT = Math.max(0.032, Math.min(0.055, winW * 0.035))
  const casingT = Math.max(0.052, Math.min(0.09, winW * 0.05))
  const depth = thick + 0.055
  const detailZ = 0
  const glassZ = detailZ
  const style = opening.window_style ?? 'double_hung'
  const frameColor = opening.frame_color ?? '#f8f4ec'
  const sashColor = selected ? '#93c5fd' : '#eef0eb'
  const glassColor = '#eef7f8'
  const glassOpacity = 0.34
  const sillColor = '#f4ead8'
  const isDoubleHung = style === 'double_hung' || style === 'single_hung' || style === 'cottage'
  const isSlider = style === 'two_panel_slider' || style === 'three_panel_slider'
  const isAwning = style === 'awning' || style === 'hopper' || style === 'egress'
  const isCasement = style === 'casement' || style === 'tilt_turn' || style === 'center_pivot' || style === 'storm'
  const isBay = style === 'bay' || style === 'bow' || style === 'garden' || style === 'oriel'
  const isDecorativeArch = style === 'lunette' || style === 'radius' || style === 'palladian'
  const bar = (
    key: string,
    position: [number, number, number],
    size: [number, number, number],
    color = frameColor,
    roughness = 0.58,
    metalness = 0,
  ) => (
    <mesh key={key} position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  )

  return (
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]} onPointerDown={onPointerDown}>
      {[-1, 1].map(side => bar(
        `outer-side-${side}`,
        [side * (winW / 2 + frameT / 2), winMidY, 0],
        [frameT, winH + frameT * 2, depth],
      ))}
      {[-1, 1].map(side => bar(
        `outer-rail-${side}`,
        [0, winMidY + side * (winH / 2 + frameT / 2), 0],
        [winW + frameT * 2, frameT, depth],
      ))}

      {[-1, 1].flatMap(face => [-1, 1].map(side => bar(
        `casing-side-${face}-${side}`,
        [side * (winW / 2 + frameT + casingT / 2), winMidY, face * (depth / 2 + 0.02)],
        [casingT, winH + frameT * 2.9, 0.075],
        frameColor,
      )))}
      {[-1, 1].flatMap(face => [-1, 1].map(side => bar(
        `casing-rail-${face}-${side}`,
        [0, winMidY + side * (winH / 2 + frameT + casingT / 2), face * (depth / 2 + 0.02)],
        [winW + frameT * 2.9, casingT, 0.075],
        frameColor,
      )))}

      {isDoubleHung && (
        <>
          {bar('center-horizontal-sash', [0, winMidY + (style === 'cottage' ? winH * 0.18 : 0), detailZ], [winW - frameT * 0.8, sashT, depth], sashColor, 0.5)}
          {bar('double-left-muntin', [-winW * 0.24, winMidY, detailZ], [sashT * 0.62, winH - frameT * 1.2, depth], sashColor, 0.5)}
          {bar('double-right-muntin', [winW * 0.24, winMidY, detailZ], [sashT * 0.62, winH - frameT * 1.2, depth], sashColor, 0.5)}
          {style === 'single_hung' && bar('single-top-muntin', [0, winMidY + winH * 0.25, detailZ], [winW - frameT * 1.2, sashT * 0.6, depth], sashColor, 0.5)}
        </>
      )}
      {isCasement && (
        <>
          {bar('casement-center-sash', [0, winMidY, glassZ - 0.014], [sashT, winH - frameT * 0.8, 0.05], sashColor, 0.5)}
          {[-1, 1].map(side => bar(`casement-hinge-${side}`, [side * (winW / 2 - frameT * 1.4), winMidY, glassZ - 0.052], [0.024, winH * 0.76, 0.03], '#b0a080', 0.35, 0.7))}
          {[-1, 1].map(side => bar(`casement-handle-${side}`, [side * winW * 0.14, winMidY, glassZ - 0.06], [0.025, 0.24, 0.025], '#b0a080', 0.28, 0.75))}
          {(style === 'tilt_turn' || style === 'storm') && bar('tilt-open-pane', [winW * 0.2, winMidY, glassZ - 0.08], [sashT, winH * 0.72, 0.055], sashColor, 0.48, 0)}
          {style === 'center_pivot' && bar('pivot-axis', [0, winMidY, glassZ - 0.07], [winW - frameT * 1.2, 0.02, 0.035], '#b0a080', 0.28, 0.75)}
        </>
      )}
      {isSlider && (
        <>
          {bar('sliding-center-sash', [0, winMidY, glassZ - 0.015], [sashT, winH - frameT * 0.8, 0.052], sashColor, 0.5)}
          {style === 'three_panel_slider' && [
            bar('sliding-left-third', [-winW / 6, winMidY, glassZ - 0.017], [sashT * 0.8, winH - frameT, 0.052], sashColor, 0.5),
            bar('sliding-right-third', [winW / 6, winMidY, glassZ - 0.017], [sashT * 0.8, winH - frameT, 0.052], sashColor, 0.5),
          ]}
          {bar('sliding-front-pane-edge', [-winW * 0.22, winMidY, glassZ - 0.045], [sashT * 0.75, winH - frameT * 1.1, 0.04], sashColor, 0.48)}
          {bar('sliding-back-pane-edge', [winW * 0.22, winMidY, glassZ + 0.012], [sashT * 0.75, winH - frameT * 1.1, 0.04], sashColor, 0.48)}
          {bar('sliding-top-track', [0, winMidY + winH / 2 - frameT * 1.7, glassZ - 0.035], [winW - frameT * 1.1, 0.018, 0.055], '#d8d5cc', 0.55)}
          {bar('sliding-bottom-track', [0, winMidY - winH / 2 + frameT * 1.7, glassZ - 0.035], [winW - frameT * 1.1, 0.018, 0.055], '#d8d5cc', 0.55)}
        </>
      )}
      {isAwning && (
        <>
          {bar('awning-top-hinge', [0, winMidY + winH / 2 - frameT * 1.15, glassZ - 0.055], [winW - frameT * 0.9, 0.024, 0.035], '#b0a080', 0.3, 0.7)}
          <mesh position={[0, winMidY - winH * 0.02, glassZ - 0.07]} rotation={[style === 'hopper' ? -0.22 : 0.18, 0, 0]}>
            <boxGeometry args={[Math.max(0.08, winW - frameT * 2.1), Math.max(0.08, winH - frameT * 2.1), 0.012]} />
            <meshStandardMaterial color={glassColor} transparent opacity={glassOpacity} depthWrite={false} roughness={0.08} metalness={0.08} />
          </mesh>
          {bar('awning-bottom-rail', [0, winMidY - winH / 2 + frameT * 1.3, glassZ - 0.09], [winW - frameT * 1.4, sashT, 0.045], sashColor, 0.48)}
          {bar('awning-crank', [0, winMidY - winH * 0.32, glassZ - 0.12], [0.18, 0.02, 0.025], '#b0a080', 0.28, 0.75)}
        </>
      )}
      {isBay && (
        <>
          <group position={[0, winMidY, glassZ - (style === 'garden' ? 0.22 : 0.12)]}>
            <mesh position={[0, 0, -0.05]}>
              <boxGeometry args={[Math.max(0.08, winW * 0.58), Math.max(0.08, winH - frameT * 2), 0.014]} />
              <meshStandardMaterial color={glassColor} transparent opacity={0.34} depthWrite={false} roughness={0.18} metalness={0.08} />
            </mesh>
            {[-1, 1].map(side => (
              <mesh key={`bay-side-pane-${side}`} position={[side * winW * 0.36, 0, 0.015]} rotation={[0, side * 0.42, 0]}>
                <boxGeometry args={[Math.max(0.08, winW * 0.28), Math.max(0.08, winH - frameT * 2.3), 0.014]} />
                <meshStandardMaterial color={glassColor} transparent opacity={0.32} depthWrite={false} roughness={0.18} metalness={0.08} />
              </mesh>
            ))}
            {bar('bay-center-frame', [0, 0, -0.074], [sashT, winH - frameT * 0.9, 0.055], sashColor, 0.5)}
            {[-1, 1].map(side => bar(`bay-front-post-${side}`, [side * winW * 0.29, 0, -0.055], [sashT, winH - frameT, 0.055], sashColor, 0.5))}
          </group>
          {bar('bay-seat', [0, winBottom - frameT * 1.05, glassZ - 0.18], [winW + frameT * 3.8, 0.08, 0.42], sillColor, 0.68)}
          {bar('bay-roof', [0, winBottom + winH + frameT * 1.05, glassZ - 0.16], [winW + frameT * 3.4, 0.07, 0.36], '#e9dfcf', 0.72)}
          {style === 'garden' && [
            bar('garden-left-depth', [-winW / 2 - frameT, winMidY, glassZ - 0.23], [frameT, winH, 0.34], sashColor, 0.5),
            bar('garden-right-depth', [winW / 2 + frameT, winMidY, glassZ - 0.23], [frameT, winH, 0.34], sashColor, 0.5),
          ]}
        </>
      )}
      {style === 'french' && (
        <>
          {bar('french-center', [0, winMidY, glassZ - 0.02], [sashT, winH - frameT, 0.052], sashColor, 0.5)}
          {[-0.28, 0.28].map((x, i) => bar(`french-vertical-${i}`, [x * winW, winMidY, glassZ - 0.02], [sashT * 0.65, winH - frameT * 1.2, 0.04], sashColor, 0.5))}
          {[-0.25, 0, 0.25].map((yPart, i) => bar(`french-horizontal-${i}`, [0, winMidY + yPart * winH, glassZ - 0.022], [winW - frameT * 1.1, sashT * 0.65, 0.04], sashColor, 0.5))}
        </>
      )}
      {style === 'glass_block' && (
        <>
          {[-0.3, -0.1, 0.1, 0.3].map((xPart, ix) => [-0.3, -0.1, 0.1, 0.3].map((yPart, iy) => (
            <mesh key={`glass-block-${ix}-${iy}`} position={[xPart * winW, winMidY + yPart * winH, glassZ - 0.04]}>
              <boxGeometry args={[winW * 0.18, winH * 0.18, 0.045]} />
              <meshStandardMaterial color={glassColor} transparent opacity={0.36} depthWrite={false} roughness={0.08} metalness={0.08} />
            </mesh>
          )))}
        </>
      )}
      {style === 'jalousie' && (
        <>
          {[-0.34, -0.2, -0.06, 0.08, 0.22, 0.36].map((yPart, i) => (
            <mesh key={`jalousie-slat-${i}`} position={[0, winMidY + yPart * winH, glassZ - 0.055]} rotation={[0.18, 0, 0]}>
              <boxGeometry args={[winW - frameT * 1.5, 0.022, 0.055]} />
              <meshStandardMaterial color={glassColor} transparent opacity={0.36} depthWrite={false} roughness={0.12} metalness={0.08} />
            </mesh>
          ))}
        </>
      )}
      {isDecorativeArch && (
        <>
          <mesh position={[0, winBottom + winH + frameT * 0.6, glassZ - 0.04]} rotation={[0, 0, 0]}>
            <torusGeometry args={[winW * (style === 'lunette' ? 0.32 : 0.2), sashT, 10, 36, Math.PI]} />
            <meshStandardMaterial color={sashColor} roughness={0.5} metalness={0} />
          </mesh>
          {style === 'palladian' && [
            bar('palladian-left-side', [-winW * 0.34, winMidY, glassZ - 0.025], [sashT, winH - frameT, 0.04], sashColor, 0.5),
            bar('palladian-right-side', [winW * 0.34, winMidY, glassZ - 0.025], [sashT, winH - frameT, 0.04], sashColor, 0.5),
            bar('palladian-center-tall', [0, winMidY + winH * 0.1, glassZ - 0.025], [sashT, winH * 1.18, 0.04], sashColor, 0.5),
          ]}
        </>
      )}
      {style === 'round' && (
        <mesh position={[0, winMidY, glassZ - 0.07]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[Math.min(winW, winH) * 0.42, sashT * 1.1, 12, 48]} />
          <meshStandardMaterial color={sashColor} roughness={0.5} metalness={0} />
        </mesh>
      )}
      {style === 'round' && [
        bar('round-horizontal', [0, winMidY, glassZ - 0.07], [Math.min(winW, winH) * 0.82, sashT, 0.045], sashColor, 0.5),
        bar('round-vertical', [0, winMidY, glassZ - 0.07], [sashT, Math.min(winW, winH) * 0.82, 0.045], sashColor, 0.5),
      ]}
      {(style === 'picture' || style === 'fixed' || style === 'transom' || style === 'skylight') && (
        <>
          {style === 'transom' && bar('transom-long-rail', [0, winMidY, glassZ - 0.02], [winW - frameT, sashT * 0.7, 0.04], sashColor, 0.5)}
          {style === 'skylight' && bar('skylight-tilt-shadow', [0, winMidY, glassZ - 0.085], [winW - frameT * 1.2, winH - frameT * 1.2, 0.012], glassColor, 0.18, 0.06)}
        </>
      )}
      {bar('sill', [0, winBottom - frameT * 0.95, -depth / 2 - 0.075], [winW + frameT * 3.3, 0.08, 0.2], sillColor, 0.68)}
      {bar('sill-lip', [0, winBottom - frameT * 1.75, -depth / 2 - 0.12], [winW + frameT * 3.6, 0.035, 0.25], '#e8d7bd', 0.72)}
    </group>
  )
}

// ─── Floor ───────────────────────────────────────────────────────────────────

function Floor({ walls }: { walls: Wall[] }) {
  const woodTexture = useMemo(() => createWoodFloorTexture(), [])
  if (walls.length === 0) {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#f6f4ef" roughness={1} />
      </mesh>
    )
  }
  const allX = walls.flatMap(w => [w.start.x, w.end.x]).map(v => v * PX)
  const allZ = walls.flatMap(w => [w.start.y, w.end.y]).map(v => v * PX)
  const minX = Math.min(...allX), maxX = Math.max(...allX)
  const minZ = Math.min(...allZ), maxZ = Math.max(...allZ)
  const floorW = maxX - minX
  const floorD = maxZ - minZ
  woodTexture.repeat.set(Math.max(1, floorW * 0.85), Math.max(1, floorD * 0.85))
  return (
    <group position={[(minX + maxX) / 2, 0, (minZ + maxZ) / 2]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]}>
        <planeGeometry args={[floorW, floorD]} />
        <meshStandardMaterial map={woodTexture} roughness={0.58} metalness={0.02} />
      </mesh>
    </group>
  )
}

// ─── Ceiling ─────────────────────────────────────────────────────────────────

function Ceiling({ walls }: { walls: Wall[] }) {
  if (walls.length === 0) return null
  const allX = walls.flatMap(w => [w.start.x, w.end.x]).map(v => v * PX)
  const allZ = walls.flatMap(w => [w.start.y, w.end.y]).map(v => v * PX)
  const minX = Math.min(...allX) - 0.5, maxX = Math.max(...allX) + 0.5
  const minZ = Math.min(...allZ) - 0.5, maxZ = Math.max(...allZ) + 0.5
  const maxH = Math.max(...walls.map(w => w.height))
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}
      position={[(minX + maxX) / 2, maxH, (minZ + maxZ) / 2]}>
      <planeGeometry args={[maxX - minX, maxZ - minZ]} />
      <meshStandardMaterial color="#f0ece4" roughness={1} side={THREE.BackSide} />
    </mesh>
  )
}

// ─── Furniture 3D ────────────────────────────────────────────────────────────

const OBJ_COLORS: Record<string, string> = {
  sofa: '#8b7355', bed: '#7a9e9f', bed_s: '#7a9e9f',
  table: '#b5835a', desk: '#c4a882', chair: '#9e8c6b',
  stairs: '#8f969c', wardrobe: '#6d7a6e', bath: '#a8c5da', toilet: '#d4e4ec', sink: '#c8dce8',
}
const OBJ_HEIGHTS: Record<string, number> = {
  sofa: 0.85, bed: 0.55, bed_s: 0.55, table: 0.75, desk: 0.75,
  chair: 0.9, stairs: 1.65, wardrobe: 1.9, bath: 0.55, toilet: 0.75, sink: 0.85,
  'floor-area': 0.08, foundation: 0.3, slab: 0.18, pad: 0.18, pier: 0.8,
  roof: 0.35, ceiling: 0.06, 'roof-hole': 0.03, railing: 1.0, deck: 0.18,
  framing: 1.2, trim: 0.12, cabinet: 0.9, electrical: 0.12, landing: 0.16, ramp: 0.5,
}

function Object3D({ obj, selected, onPointerDown }: {
  obj: PlacedObject
  selected?: boolean
  onPointerDown?: EditablePointerHandler
}) {
  if (obj.type === 'text') return null

  const x = obj.x * PX, z = obj.y * PX
  const w = obj.width * PX, d = obj.height * PX
  const h = OBJ_HEIGHTS[obj.type] ?? 0.75
  const color = OBJ_COLORS[obj.type] ?? obj.color

  const box = (
    key: string,
    position: [number, number, number],
    size: [number, number, number],
    materialColor = color
  ) => (
    <mesh key={key} position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={materialColor} roughness={0.7} metalness={0.05} />
    </mesh>
  )

  const cylinder = (
    key: string,
    position: [number, number, number],
    radius: number,
    height: number,
    materialColor = color
  ) => (
    <mesh key={key} position={position}>
      <cylinderGeometry args={[radius, radius, height, 24]} />
      <meshStandardMaterial color={materialColor} roughness={0.7} metalness={0.05} />
    </mesh>
  )

  let contents: React.ReactNode = box('base', [0, h / 2, 0], [w, h, d])

  if (obj.type === 'floor-area' || obj.type === 'foundation' || obj.type === 'slab' || obj.type === 'pad' || obj.type === 'landing') {
    contents = box('surface', [0, h / 2, 0], [w, h, d], color)
  } else if (obj.type === 'pier') {
    contents = cylinder('pier', [0, h / 2, 0], Math.min(w, d) * 0.45, h, color)
  } else if (obj.type === 'roof') {
    contents = (
      <>
        <mesh position={[-w * 0.22, h, 0]} rotation={[0, 0, 0.36]}>
          <boxGeometry args={[w * 0.62, 0.09, d]} />
          <meshStandardMaterial color={color} roughness={0.82} metalness={0} />
        </mesh>
        <mesh position={[w * 0.22, h, 0]} rotation={[0, 0, -0.36]}>
          <boxGeometry args={[w * 0.62, 0.09, d]} />
          <meshStandardMaterial color={color} roughness={0.82} metalness={0} />
        </mesh>
      </>
    )
  } else if (obj.type === 'railing' || obj.type === 'deck') {
    const postCount = Math.max(3, Math.round(w / 0.45))
    contents = (
      <>
        {obj.type === 'deck' && box('deck-base', [0, 0.08, 0], [w, 0.16, d], color)}
        {Array.from({ length: postCount }).map((_, index) => {
          const xPos = -w / 2 + (w * index) / (postCount - 1)
          return box(`rail-post-${index}`, [xPos, 0.5, 0], [0.045, 1, 0.045], '#e8e2d8')
        })}
        {box('rail-top', [0, 1, 0], [w, 0.06, 0.07], '#7b5734')}
      </>
    )
  } else if (obj.type === 'bed' || obj.type === 'bed_s') {
    contents = (
      <>
        {box('frame', [0, 0.18, 0], [w, 0.22, d], '#6b5a47')}
        {box('mattress', [0, 0.36, 0.04], [w * 0.92, 0.22, d * 0.86], '#dbe7ea')}
        {box('pillow-a', [-w * 0.24, 0.52, -d * 0.33], [w * 0.34, 0.12, d * 0.16], '#f8fafc')}
        {obj.type === 'bed' && box('pillow-b', [w * 0.24, 0.52, -d * 0.33], [w * 0.34, 0.12, d * 0.16], '#f8fafc')}
      </>
    )
  } else if (obj.type === 'sofa') {
    contents = (
      <>
        {box('seat', [0, 0.22, 0.06], [w, 0.32, d * 0.72], color)}
        {box('back', [0, 0.55, -d * 0.36], [w, 0.55, d * 0.18], '#6f5d49')}
        {box('left-arm', [-w * 0.48, 0.42, 0.05], [w * 0.1, 0.5, d * 0.72], '#6f5d49')}
        {box('right-arm', [w * 0.48, 0.42, 0.05], [w * 0.1, 0.5, d * 0.72], '#6f5d49')}
      </>
    )
  } else if (obj.type === 'table' || obj.type === 'desk') {
    contents = (
      <>
        {box('top', [0, h, 0], [w, 0.08, d], color)}
        {box('leg-a', [-w * 0.38, h / 2, -d * 0.38], [0.06, h, 0.06], '#6b4f38')}
        {box('leg-b', [w * 0.38, h / 2, -d * 0.38], [0.06, h, 0.06], '#6b4f38')}
        {box('leg-c', [-w * 0.38, h / 2, d * 0.38], [0.06, h, 0.06], '#6b4f38')}
        {box('leg-d', [w * 0.38, h / 2, d * 0.38], [0.06, h, 0.06], '#6b4f38')}
      </>
    )
  } else if (obj.type === 'chair') {
    contents = (
      <>
        {box('seat', [0, 0.35, 0.05], [w, 0.12, d * 0.85], color)}
        {box('back', [0, 0.72, -d * 0.38], [w, 0.58, 0.08], '#7a6a52')}
        {box('leg-a', [-w * 0.35, 0.18, -d * 0.28], [0.04, 0.36, 0.04], '#5f513f')}
        {box('leg-b', [w * 0.35, 0.18, -d * 0.28], [0.04, 0.36, 0.04], '#5f513f')}
        {box('leg-c', [-w * 0.35, 0.18, d * 0.28], [0.04, 0.36, 0.04], '#5f513f')}
        {box('leg-d', [w * 0.35, 0.18, d * 0.28], [0.04, 0.36, 0.04], '#5f513f')}
      </>
    )
  } else if (obj.type === 'stairs') {
    const stepCount = Math.max(3, obj.stair_steps ?? 12)
    const stairHeight = obj.stair_height ?? 2.8
    const railColor = '#f2ede2'
    const handrailColor = '#7b5734'
    const landingColor = '#d7b17d'
    const stepColor = '#b87f45'
    const treadColor = '#d9aa68'
    const riserColor = '#eee7dc'
    const stringerColor = '#e8dfd2'
    const noseColor = '#f4e0bf'
    const rail = (
      key: string,
      position: [number, number, number],
      size: [number, number, number],
      materialColor = railColor
    ) => box(key, position, size, materialColor)
    const renderRun = (
      keyPrefix: string,
      startX: number,
      startZ: number,
      runW: number,
      runD: number,
      startH: number,
      endH: number,
      count: number,
      direction: 'x' | 'z' = 'x',
      runRailColor = railColor,
      forward: 1 | -1 = 1
    ) => {
      const parts: React.ReactNode[] = []
      const treadThickness = 0.055
      const riserThickness = 0.035
      const rise = (endH - startH) / count
      const railThickness = 0.06
      const railLift = 0.78
      const runLength = direction === 'x' ? runW : runD
      const railLength = Math.hypot(runLength, endH - startH)
      const railAngle = Math.atan2(endH - startH, runLength * forward)
      const treadLength = runLength / count
      const stairThickness = Math.max(0.03, Math.min(0.075, treadLength * 0.28))
      const balusterCount = Math.max(3, Math.min(12, count + 1))
      for (let i = 0; i < count; i += 1) {
        const t0 = i / count
        const t1 = (i + 1) / count
        const height = startH + rise * (i + 1)
        const xPos = direction === 'x' ? startX + forward * runW * (t0 + 0.5 / count) : startX
        const zPos = direction === 'z' ? startZ + forward * runD * (t0 + 0.5 / count) : startZ
        const leadingX = direction === 'x' ? startX + forward * runW * t1 : startX
        const leadingZ = direction === 'z' ? startZ + forward * runD * t1 : startZ
        parts.push(box(
          `${keyPrefix}-tread-${i}`,
          [xPos, height + treadThickness / 2, zPos],
          [
            direction === 'x' ? Math.max(0.04, runW / count - 0.012) : runW,
            treadThickness,
            direction === 'z' ? Math.max(0.04, runD / count - 0.012) : runD,
          ],
          i % 2 === 0 ? treadColor : '#e4caa8'
        ))
        parts.push(box(
          `${keyPrefix}-nosing-${i}`,
          [leadingX, height + treadThickness + 0.012, leadingZ],
          [direction === 'x' ? 0.05 : runW * 0.98, 0.025, direction === 'z' ? 0.05 : runD * 0.98],
          noseColor
        ))
        parts.push(box(
          `${keyPrefix}-riser-${i}`,
          [
            direction === 'x' ? startX + forward * runW * t1 : startX,
            height - rise / 2,
            direction === 'z' ? startZ + forward * runD * t1 : startZ,
          ],
          [direction === 'x' ? riserThickness : runW * 0.96, Math.max(0.04, rise), direction === 'z' ? riserThickness : runD * 0.96],
          riserColor
        ))
      }
      const railY = (startH + endH) / 2 + railLift
      if (direction === 'x') {
        parts.push(
          <mesh key={`${keyPrefix}-stringer-a`} position={[startX + forward * runW / 2, (startH + endH) / 2 + 0.03, startZ - runD / 2 + 0.05]} rotation={[0, 0, railAngle]}>
            <boxGeometry args={[railLength, stairThickness * 1.6, stairThickness * 1.25]} />
            <meshStandardMaterial color={stringerColor} roughness={0.76} metalness={0} />
          </mesh>
        )
        parts.push(
          <mesh key={`${keyPrefix}-stringer-b`} position={[startX + forward * runW / 2, (startH + endH) / 2 + 0.03, startZ + runD / 2 - 0.05]} rotation={[0, 0, railAngle]}>
            <boxGeometry args={[railLength, stairThickness * 1.6, stairThickness * 1.25]} />
            <meshStandardMaterial color={stringerColor} roughness={0.76} metalness={0} />
          </mesh>
        )
        parts.push(
          <mesh key={`${keyPrefix}-rail-a`} position={[startX + forward * runW / 2, railY, startZ - runD / 2 + 0.035]} rotation={[0, 0, railAngle]}>
            <boxGeometry args={[railLength, railThickness, railThickness]} />
            <meshStandardMaterial color={runRailColor === railColor ? handrailColor : runRailColor} roughness={0.46} metalness={0.04} />
          </mesh>
        )
        parts.push(
          <mesh key={`${keyPrefix}-rail-b`} position={[startX + forward * runW / 2, railY, startZ + runD / 2 - 0.035]} rotation={[0, 0, railAngle]}>
            <boxGeometry args={[railLength, railThickness, railThickness]} />
            <meshStandardMaterial color={runRailColor === railColor ? handrailColor : runRailColor} roughness={0.46} metalness={0.04} />
          </mesh>
        )
        Array.from({ length: balusterCount }).forEach((_, index) => {
          const t = balusterCount === 1 ? 0.5 : index / (balusterCount - 1)
          const postH = index === 0 || index === balusterCount - 1 ? 0.82 : 0.64
          const postX = startX + forward * runW * t
          const postBaseY = startH + t * (endH - startH)
          const postSize = index === 0 || index === balusterCount - 1 ? 0.052 : 0.032
          parts.push(rail(`${keyPrefix}-post-a-${index}`, [postX, postBaseY + postH / 2 + 0.17, startZ - runD / 2 + 0.035], [postSize, postH, postSize], runRailColor))
          parts.push(rail(`${keyPrefix}-post-b-${index}`, [postX, postBaseY + postH / 2 + 0.17, startZ + runD / 2 - 0.035], [postSize, postH, postSize], runRailColor))
        })
      } else {
        parts.push(
          <mesh key={`${keyPrefix}-stringer-a`} position={[startX - runW / 2 + 0.05, (startH + endH) / 2 + 0.03, startZ + forward * runD / 2]} rotation={[-railAngle, 0, 0]}>
            <boxGeometry args={[stairThickness * 1.25, stairThickness * 1.6, railLength]} />
            <meshStandardMaterial color={stringerColor} roughness={0.76} metalness={0} />
          </mesh>
        )
        parts.push(
          <mesh key={`${keyPrefix}-stringer-b`} position={[startX + runW / 2 - 0.05, (startH + endH) / 2 + 0.03, startZ + forward * runD / 2]} rotation={[-railAngle, 0, 0]}>
            <boxGeometry args={[stairThickness * 1.25, stairThickness * 1.6, railLength]} />
            <meshStandardMaterial color={stringerColor} roughness={0.76} metalness={0} />
          </mesh>
        )
        parts.push(
          <mesh key={`${keyPrefix}-rail-a`} position={[startX - runW / 2 + 0.035, railY, startZ + forward * runD / 2]} rotation={[-railAngle, 0, 0]}>
            <boxGeometry args={[railThickness, railThickness, railLength]} />
            <meshStandardMaterial color={runRailColor === railColor ? handrailColor : runRailColor} roughness={0.46} metalness={0.04} />
          </mesh>
        )
        parts.push(
          <mesh key={`${keyPrefix}-rail-b`} position={[startX + runW / 2 - 0.035, railY, startZ + forward * runD / 2]} rotation={[-railAngle, 0, 0]}>
            <boxGeometry args={[railThickness, railThickness, railLength]} />
            <meshStandardMaterial color={runRailColor === railColor ? handrailColor : runRailColor} roughness={0.46} metalness={0.04} />
          </mesh>
        )
        Array.from({ length: balusterCount }).forEach((_, index) => {
          const t = balusterCount === 1 ? 0.5 : index / (balusterCount - 1)
          const postH = index === 0 || index === balusterCount - 1 ? 0.82 : 0.64
          const postZ = startZ + forward * runD * t
          const postBaseY = startH + t * (endH - startH)
          const postSize = index === 0 || index === balusterCount - 1 ? 0.052 : 0.032
          parts.push(rail(`${keyPrefix}-post-a-${index}`, [startX - runW / 2 + 0.035, postBaseY + postH / 2 + 0.17, postZ], [postSize, postH, postSize], runRailColor))
          parts.push(rail(`${keyPrefix}-post-b-${index}`, [startX + runW / 2 - 0.035, postBaseY + postH / 2 + 0.17, postZ], [postSize, postH, postSize], runRailColor))
        })
      }
      return parts
    }

    if (obj.stair_shape === 'landing') {
      const landingW = Math.min(w * 0.42, Math.max(0.48, (obj.landing_width ?? 80) * PX))
      const landingD = Math.min(d * 0.58, Math.max(0.48, (obj.landing_depth ?? 80) * PX))
      const firstRunW = Math.max(0.36, w - landingW)
      const secondRunD = Math.max(0.36, (d - landingD) / 2)
      const firstSteps = Math.max(3, Math.floor(stepCount / 2))
      const secondSteps = Math.max(3, stepCount - firstSteps)
      const midH = stairHeight * 0.5
      const landingX = w / 2 - landingW / 2
      const turnRight = obj.landing_turn === 'right'
      const landingZ = 0
      const secondStartZ = turnRight ? landingD / 2 : -landingD / 2
      const secondForward: 1 | -1 = turnRight ? 1 : -1
      const railEdgeZ = turnRight ? d / 2 - 0.055 : -d / 2 + 0.055
      const landingFarZ = turnRight ? landingD / 2 - 0.055 : -landingD / 2 + 0.055
      const railH = 0.78
      const landingPost = (key: string, xPos: number, zPos: number) =>
        rail(key, [xPos, midH + railH / 2 + 0.08, zPos], [0.05, railH, 0.05])
      contents = (
        <>
          {renderRun('landing-lower-run', -w / 2, landingZ, firstRunW, landingD, 0, midH, firstSteps, 'x')}
          {box('mid-landing', [landingX, midH + 0.04, landingZ], [landingW, 0.08, landingD], landingColor)}
          {renderRun('landing-upper-run', landingX, secondStartZ, landingW, secondRunD, midH, stairHeight, secondSteps, 'z', railColor, secondForward)}
          {landingPost('landing-post-a', w / 2 - 0.055, railEdgeZ)}
          {landingPost('landing-post-b', w / 2 - 0.055, landingFarZ)}
          {landingPost('landing-post-c', w / 2 - landingW + 0.055, railEdgeZ)}
          {rail('landing-side-rail-a', [w / 2 - 0.055, midH + railH + 0.08, landingZ], [0.055, 0.055, landingD], handrailColor)}
          {rail('landing-side-rail-b', [landingX, midH + railH + 0.08, railEdgeZ], [landingW, 0.055, 0.055], handrailColor)}
        </>
      )
    } else if (obj.stair_shape === 'return_landing') {
      const legacyLandingW = Math.min(w * 0.34, Math.max(0.48, (obj.landing_width ?? 80) * PX))
      const landingW = (obj.landing_width ?? obj.landingWidth) !== undefined
        ? (obj.landing_width ?? obj.landingWidth)! * PX
        : legacyLandingW
      const legacyRunW = Math.max(0.24, w - landingW)
      const leftRunW = (obj.left_run_width ?? obj.leftRunWidth) !== undefined
        ? (obj.left_run_width ?? obj.leftRunWidth)! * PX
        : legacyRunW
      const rightRunW = (obj.right_run_width ?? obj.rightRunWidth) !== undefined
        ? (obj.right_run_width ?? obj.rightRunWidth)! * PX
        : legacyRunW
      const runD = Math.min(Math.max(0.3, (obj.landing_depth ?? 80) * PX), Math.max(0.3, (d - 0.16) / 2))
      const firstSteps = Math.max(3, Math.floor(stepCount / 2))
      const secondSteps = Math.max(3, stepCount - firstSteps)
      const midH = stairHeight * 0.5
      const mirrored = obj.landing_turn === 'right'
      const landingX = mirrored ? -w / 2 + landingW / 2 : w / 2 - landingW / 2
      const landingJoinX = mirrored ? -w / 2 + landingW : w / 2 - landingW
      const lowerStartX = mirrored ? landingJoinX + leftRunW : landingJoinX - leftRunW
      const lowerForward: 1 | -1 = mirrored ? -1 : 1
      const upperStartX = landingJoinX
      const upperForward: 1 | -1 = mirrored ? 1 : -1
      const outerRailX = mirrored ? -w / 2 + 0.055 : w / 2 - 0.055
      const innerRailX = mirrored ? -w / 2 + landingW - 0.055 : w / 2 - landingW + 0.055
      const lowerZ = d / 2 - runD / 2
      const upperZ = -d / 2 + runD / 2
      const railH = 0.78
      const landingPost = (key: string, xPos: number, zPos: number) =>
        rail(key, [xPos, midH + railH / 2 + 0.08, zPos], [0.05, railH, 0.05])
      contents = (
        <>
          {renderRun('return-lower-run', lowerStartX, lowerZ, leftRunW, runD, 0, midH, firstSteps, 'x', railColor, lowerForward)}
          {box('return-mid-landing', [landingX, midH + 0.04, 0], [landingW, 0.08, d], landingColor)}
          {renderRun('return-upper-run', upperStartX, upperZ, rightRunW, runD, midH, stairHeight, secondSteps, 'x', railColor, upperForward)}
          {landingPost('return-landing-post-a', outerRailX, d / 2 - 0.055)}
          {landingPost('return-landing-post-b', outerRailX, -d / 2 + 0.055)}
          {landingPost('return-landing-post-c', innerRailX, d / 2 - 0.055)}
          {landingPost('return-landing-post-d', innerRailX, -d / 2 + 0.055)}
          {rail('return-landing-outer-rail', [outerRailX, midH + railH + 0.08, 0], [0.055, 0.055, d], handrailColor)}
          {rail('return-landing-back-rail', [landingX, midH + railH + 0.08, -d / 2 + 0.055], [landingW, 0.055, 0.055], handrailColor)}
          {rail('return-landing-front-rail', [landingX, midH + railH + 0.08, d / 2 - 0.055], [landingW, 0.055, 0.055], handrailColor)}
        </>
      )
    } else {
      contents = (
        <>
          {renderRun('straight-run', -w / 2, 0, w, d, 0, stairHeight, stepCount, 'x')}
        </>
      )
    }
  } else if (obj.type === 'wardrobe') {
    contents = (
      <>
        {box('body', [0, h / 2, 0], [w, h, d], color)}
        {box('left-door', [-w * 0.25, h / 2, d / 2 + 0.01], [w * 0.48, h * 0.92, 0.025], '#748473')}
        {box('right-door', [w * 0.25, h / 2, d / 2 + 0.01], [w * 0.48, h * 0.92, 0.025], '#748473')}
      </>
    )
  } else if (obj.type === 'bath') {
    contents = (
      <>
        {box('tub', [0, 0.28, 0], [w, 0.45, d], '#dceff8')}
        {box('inner', [0, 0.52, 0], [w * 0.78, 0.08, d * 0.74], '#a8c5da')}
      </>
    )
  } else if (obj.type === 'toilet') {
    contents = (
      <>
        {box('tank', [0, 0.42, -d * 0.32], [w * 0.8, 0.42, d * 0.22], '#d4e4ec')}
        {cylinder('bowl', [0, 0.34, d * 0.1], Math.min(w, d) * 0.32, 0.22, '#eef8fc')}
      </>
    )
  } else if (obj.type === 'sink') {
    contents = (
      <>
        {box('counter', [0, 0.42, 0], [w, 0.18, d], '#d9edf5')}
        {cylinder('basin', [0, 0.56, 0], Math.min(w, d) * 0.28, 0.08, '#f8fafc')}
      </>
    )
  }

  return (
    <group position={[x, obj.elevation ?? 0, z]} rotation={[0, -(obj.rotation * Math.PI) / 180, 0]} onPointerDown={onPointerDown}>
      {contents}
      {selected && (
        <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(w, d) * 0.56, Math.max(w, d) * 0.62, 48]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.78} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}

// ─── Camera initializer ──────────────────────────────────────────────────────

function ResizeHandle3D({ position, color = '#2563eb', onPointerDown }: {
  position: [number, number, number]
  color?: string
  onPointerDown: EditablePointerHandler
}) {
  return (
    <mesh position={position} onPointerDown={onPointerDown}>
      <sphereGeometry args={[0.09, 16, 16]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} roughness={0.42} />
    </mesh>
  )
}

function WallResizeHandles({ wall, onHandlePointerDown, onHeightPointerDown }: {
  wall: Wall
  onHandlePointerDown: (endpoint: 'start' | 'end') => EditablePointerHandler
  onHeightPointerDown: EditablePointerHandler
}) {
  const y = wall.height + 0.12
  const centerX = (wall.start.x + wall.end.x) * PX / 2
  const centerZ = (wall.start.y + wall.end.y) * PX / 2
  return (
    <>
      <ResizeHandle3D position={[wall.start.x * PX, y, wall.start.y * PX]} onPointerDown={onHandlePointerDown('start')} />
      <ResizeHandle3D position={[wall.end.x * PX, y, wall.end.y * PX]} onPointerDown={onHandlePointerDown('end')} />
      <ResizeHandle3D position={[centerX, wall.height + 0.32, centerZ]} color="#a855f7" onPointerDown={onHeightPointerDown} />
    </>
  )
}

function OpeningResizeHandle({ wall, opening, onPointerDown, onHeightPointerDown }: {
  wall: Wall
  opening: Opening
  onPointerDown: EditablePointerHandler
  onHeightPointerDown?: EditablePointerHandler
}) {
  const center = openingCenter(wall, opening)
  const angle = opening.rotation !== undefined ? (opening.rotation * Math.PI) / 180 : wallAngle(wall)
  const openingBottom = opening.type === 'window' ? (opening.elevation ?? 0.9) : (opening.elevation ?? 0)
  const openingHeight = opening.height
    ?? (opening.type === 'window' ? opening.width * PX * 1.2 : opening.type === 'door' ? 2.1 : 1.45)
  const handleX = center.x + Math.cos(angle) * opening.width * PX / 2
  const handleZ = center.z + Math.sin(angle) * opening.width * PX / 2
  const y = Math.max(0.45, Math.min(openingBottom + openingHeight * 0.55, openingBottom + openingHeight + 0.14))
  return (
    <>
      <ResizeHandle3D position={[handleX, y, handleZ]} color="#10b981" onPointerDown={onPointerDown} />
      {onHeightPointerDown && (
        <ResizeHandle3D
          position={[center.x, openingBottom + openingHeight + 0.28, center.z]}
          color="#a855f7"
          onPointerDown={onHeightPointerDown}
        />
      )}
    </>
  )
}

function ObjectResizeHandles({ obj, onHandlePointerDown, onReturnPartPointerDown }: {
  obj: PlacedObject
  onHandlePointerDown: (corner: ResizeCorner) => EditablePointerHandler
  onReturnPartPointerDown: (part: ReturnStairPart) => EditablePointerHandler
}) {
  if (obj.type === 'text') return null
  const w = obj.width * PX
  const d = obj.height * PX
  const x = obj.x * PX
  const z = obj.y * PX
  const elevation = obj.elevation ?? 0
  if (obj.type === 'stairs' && obj.stair_shape === 'return_landing') {
    const legacyLandingWidth = Math.min(obj.width * 0.34, Math.max(34, obj.landing_width ?? 80))
    const landingWidth = obj.landing_width ?? obj.landingWidth ?? legacyLandingWidth
    const legacyRunWidth = Math.max(12, obj.width - landingWidth)
    const leftRunWidth = obj.left_run_width ?? obj.leftRunWidth ?? legacyRunWidth
    const rightRunWidth = obj.right_run_width ?? obj.rightRunWidth ?? legacyRunWidth
    const runDepth = Math.min(Math.max(22, obj.landing_depth ?? 80), Math.max(22, (obj.height - 10) / 2))
    const stairHeight = obj.stair_height ?? 2.8
    const landingHeight = stairHeight * 0.5
    const mirrored = obj.landing_turn === 'right'
    const outerX = mirrored ? -obj.width / 2 : obj.width / 2
    const landingJoinX = mirrored ? outerX + landingWidth : outerX - landingWidth
    const leftEndX = mirrored ? landingJoinX + leftRunWidth : landingJoinX - leftRunWidth
    const rightEndX = mirrored ? landingJoinX + rightRunWidth : landingJoinX - rightRunWidth

    return (
      <group position={[x, elevation, z]} rotation={[0, -(obj.rotation * Math.PI) / 180, 0]}>
        <ResizeHandle3D
          position={[outerX * PX, landingHeight + 0.24, 0]}
          color="#a855f7"
          onPointerDown={onReturnPartPointerDown('landing')}
        />
        <ResizeHandle3D
          position={[leftEndX * PX, 0.22, (obj.height / 2 - runDepth / 2) * PX]}
          color="#2563eb"
          onPointerDown={onReturnPartPointerDown('left')}
        />
        <ResizeHandle3D
          position={[rightEndX * PX, stairHeight + 0.24, (-obj.height / 2 + runDepth / 2) * PX]}
          color="#10b981"
          onPointerDown={onReturnPartPointerDown('right')}
        />
      </group>
    )
  }
  const positions: Array<[ResizeCorner, number, number]> = [
    ['nw', -w / 2, -d / 2],
    ['ne', w / 2, -d / 2],
    ['sw', -w / 2, d / 2],
    ['se', w / 2, d / 2],
  ]

  return (
    <group position={[x, elevation, z]} rotation={[0, -(obj.rotation * Math.PI) / 180, 0]}>
      {positions.map(([corner, localX, localZ]) => (
        <ResizeHandle3D
          key={corner}
          position={[localX, 0.12, localZ]}
          color="#f59e0b"
          onPointerDown={onHandlePointerDown(corner)}
        />
      ))}
    </group>
  )
}

function CameraInit({ walls }: { walls: Wall[] }) {
  const { camera } = useThree()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || walls.length === 0) return
    const allX = walls.flatMap(w => [w.start.x, w.end.x]).map(v => v * PX)
    const allZ = walls.flatMap(w => [w.start.y, w.end.y]).map(v => v * PX)
    const cx = (Math.min(...allX) + Math.max(...allX)) / 2
    const cz = (Math.min(...allZ) + Math.max(...allZ)) / 2
    const span = Math.max(Math.max(...allX) - Math.min(...allX), Math.max(...allZ) - Math.min(...allZ), 4)
    camera.position.set(cx + span * 0.95, Math.max(span * 0.72, 3.6), cz + span * 1.1)
    camera.lookAt(cx, 0.55, cz)
    done.current = true
  }, [camera, walls])
  return null
}

function getPlanView(walls: Wall[]) {
  if (walls.length === 0) {
    return { target: new THREE.Vector3(0, 0, 0), span: 8 }
  }

  const allX = walls.flatMap(w => [w.start.x, w.end.x]).map(v => v * PX)
  const allZ = walls.flatMap(w => [w.start.y, w.end.y]).map(v => v * PX)
  const minX = Math.min(...allX)
  const maxX = Math.max(...allX)
  const minZ = Math.min(...allZ)
  const maxZ = Math.max(...allZ)
  const span = Math.max(maxX - minX, maxZ - minZ, 4)
  return {
    target: new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
    span,
  }
}

function VideoRecorder3D({ walls }: { walls: Wall[] }) {
  const { camera, gl } = useThree()
  const recording = useRef<RecordingState | null>(null)

  useEffect(() => {
    const startRecording = (event: Event) => {
      const detail = (event as CustomEvent<VideoRecordDetail>).detail
      if (recording.current) {
        detail.reject?.(new Error('3D video recording is already running'))
        return
      }

      const canvas = gl.domElement
      if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
        detail.reject?.(new Error('3D video recording is not supported in this browser'))
        return
      }

      const stream = canvas.captureStream(30)
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? 'video/webm;codecs=vp8'
          : 'video/webm'
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 })
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (recorderEvent) => {
        if (recorderEvent.data.size > 0) chunks.push(recorderEvent.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop())
        const blob = new Blob(chunks, { type: 'video/webm' })
        const filename = detail.filename ?? 'homeplanner-3d-view.webm'
        const finish = () => {
          recording.current = null
          detail.resolve?.()
        }
        if (detail.saveBlob) {
          detail.saveBlob(blob, filename).then(finish).catch((error) => {
            recording.current = null
            detail.reject?.(error instanceof Error ? error : new Error('3D video save failed'))
          })
          return
        }
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
        finish()
      }
      recorder.onerror = () => {
        stream.getTracks().forEach(track => track.stop())
        recording.current = null
        detail.reject?.(new Error('3D video recording failed'))
      }

      const { target, span } = getPlanView(walls)
      const radius = Math.max(span * 1.45, 5.5)
      const topRadius = Math.max(span * 0.45, 2.4)
      const height = Math.max(span * 0.78, 3.6)
      const topHeight = Math.max(span * 2.2, 8)
      camera.position.set(target.x + topRadius, topHeight, target.z + topRadius * 0.35)
      camera.lookAt(target)

      recording.current = {
        startTime: performance.now(),
        durationMs: detail.durationMs ?? 30000,
        target,
        radius,
        topRadius,
        height,
        topHeight,
        recorder,
        stopped: false,
      }
      recorder.start(250)
    }

    window.addEventListener('homeplanner:record-3d', startRecording)
    return () => window.removeEventListener('homeplanner:record-3d', startRecording)
  }, [camera, gl, walls])

  useFrame(() => {
    const active = recording.current
    if (!active) return

    const elapsed = performance.now() - active.startTime
    const progress = Math.min(elapsed / active.durationMs, 1)
    const keyframes = [
      { t: 0, angle: -Math.PI / 3, radius: active.topRadius, height: active.topHeight },
      { t: 0.16, angle: Math.PI / 6, radius: active.topRadius * 1.15, height: active.topHeight },
      { t: 0.34, angle: Math.PI / 2, radius: active.radius, height: active.height * 1.15 },
      { t: 0.52, angle: Math.PI, radius: active.radius, height: active.height },
      { t: 0.7, angle: Math.PI * 1.5, radius: active.radius, height: active.height * 1.08 },
      { t: 0.88, angle: Math.PI * 2, radius: active.radius * 0.95, height: active.height * 1.35 },
      { t: 1, angle: Math.PI * 2.35, radius: active.topRadius * 1.25, height: active.topHeight * 0.92 },
    ]
    const nextIndex = keyframes.findIndex((frame) => frame.t >= progress)
    const endFrame = keyframes[Math.max(1, nextIndex)]
    const startFrame = keyframes[Math.max(0, Math.max(1, nextIndex) - 1)]
    const segmentProgress = (progress - startFrame.t) / Math.max(0.001, endFrame.t - startFrame.t)
    const easedProgress = segmentProgress * segmentProgress * (3 - 2 * segmentProgress)
    const angle = startFrame.angle + (endFrame.angle - startFrame.angle) * easedProgress
    const radius = startFrame.radius + (endFrame.radius - startFrame.radius) * easedProgress
    const height = startFrame.height + (endFrame.height - startFrame.height) * easedProgress
    camera.position.set(
      active.target.x + Math.cos(angle) * radius,
      height,
      active.target.z + Math.sin(angle) * radius
    )
    camera.lookAt(active.target)

    if (progress >= 1 && !active.stopped) {
      active.stopped = true
      active.recorder.stop()
    }
  })

  return null
}

// ─── Scene ───────────────────────────────────────────────────────────────────

function Scene({ spacePan }: { spacePan: boolean }) {
  const walls = useFloorPlanStore(s => s.walls)
  const openings = useFloorPlanStore(s => s.openings)
  const objects = useFloorPlanStore(s => s.objects)
  const activeTool = useFloorPlanStore(s => s.activeTool)
  const selectedId = useFloorPlanStore(s => s.selectedId)
  const gridSize = useFloorPlanStore(s => s.grid_size)
  const setSelected = useFloorPlanStore(s => s.setSelected)
  const pushHistory = useFloorPlanStore(s => s.pushHistory)
  const updateWall = useFloorPlanStore(s => s.updateWall)
  const updateObject = useFloorPlanStore(s => s.updateObject)
  const removeObject = useFloorPlanStore(s => s.removeObject)
  const updateOpening = useFloorPlanStore(s => s.updateOpening)
  const removeOpening = useFloorPlanStore(s => s.removeOpening)
  const removeWall = useFloorPlanStore(s => s.removeWall)
  const isEmpty = walls.length === 0
  const isPanTool = activeTool === 'pan' || spacePan
  const [dragging, setDragging] = useState<DragState | null>(null)
  const wallBounds = useMemo(() => walls.length ? getWallBounds(walls) : null, [walls])
  const editEnabled = activeTool === 'select' || activeTool === 'object'

  const handleWallPointerDown = (wall: Wall): EditablePointerHandler => (event) => {
    event.stopPropagation()
    if (activeTool === 'delete') {
      removeWall(wall.id)
      return
    }
    if (activeTool === 'select') setSelected(wall.id)
  }

  const handleObjectPointerDown = (obj: PlacedObject): EditablePointerHandler => (event) => {
    event.stopPropagation()
    if (activeTool === 'delete') {
      removeObject(obj.id)
      return
    }
    if (!editEnabled) return

    const point = getGroundPoint(event)
    if (!point) return
    setSelected(obj.id)
    pushHistory()
    setDragging({
      type: 'object',
      id: obj.id,
      pointerId: event.pointerId,
      offsetX: obj.x - point.x / PX,
      offsetZ: obj.y - point.z / PX,
    })
  }

  const handleOpeningPointerDown = (opening: Opening): EditablePointerHandler => (event) => {
    event.stopPropagation()
    if (activeTool === 'delete') {
      removeOpening(opening.id)
      return
    }
    if (!editEnabled) return

    setSelected(opening.id)
    pushHistory()
    setDragging({
      type: 'opening',
      id: opening.id,
      wallId: opening.wall_id,
      pointerId: event.pointerId,
    })
  }

  const handleWallEndpointPointerDown = (wall: Wall, endpoint: 'start' | 'end'): EditablePointerHandler => (event) => {
    event.stopPropagation()
    if (activeTool !== 'select') return
    setSelected(wall.id)
    pushHistory()
    setDragging({
      type: 'wall-endpoint',
      id: wall.id,
      endpoint,
      pointerId: event.pointerId,
    })
  }

  const handleWallHeightPointerDown = (wall: Wall): EditablePointerHandler => (event) => {
    event.stopPropagation()
    if (activeTool !== 'select') return
    setSelected(wall.id)
    pushHistory()
    setDragging({
      type: 'wall-height',
      id: wall.id,
      pointerId: event.pointerId,
      startHeight: wall.height,
      startClientY: event.clientY,
    })
  }

  const handleOpeningResizePointerDown = (opening: Opening): EditablePointerHandler => (event) => {
    event.stopPropagation()
    if (!editEnabled) return
    setSelected(opening.id)
    pushHistory()
    setDragging({
      type: 'opening-resize',
      id: opening.id,
      wallId: opening.wall_id,
      pointerId: event.pointerId,
    })
  }

  const handleOpeningHeightPointerDown = (opening: Opening): EditablePointerHandler => (event) => {
    event.stopPropagation()
    if (!editEnabled) return
    setSelected(opening.id)
    pushHistory()
    setDragging({
      type: 'opening-height',
      id: opening.id,
      pointerId: event.pointerId,
      startHeight: opening.height
        ?? (opening.type === 'window' ? opening.width * PX * 1.2 : opening.type === 'door' ? 2.1 : 1.45),
      startClientY: event.clientY,
    })
  }

  const handleObjectResizePointerDown = (obj: PlacedObject, corner: ResizeCorner): EditablePointerHandler => (event) => {
    event.stopPropagation()
    if (!editEnabled) return
    setSelected(obj.id)
    pushHistory()
    setDragging({
      type: 'object-resize',
      id: obj.id,
      pointerId: event.pointerId,
      corner,
      start: {
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        rotation: obj.rotation,
      },
    })
  }

  const handleReturnStairResizePointerDown = (
    obj: PlacedObject,
    part: ReturnStairPart,
  ): EditablePointerHandler => (event) => {
    event.stopPropagation()
    if (!editEnabled) return
    const legacyLandingWidth = Math.min(obj.width * 0.34, Math.max(34, obj.landing_width ?? 80))
    const landingWidth = obj.landing_width ?? obj.landingWidth ?? legacyLandingWidth
    const legacyRunWidth = Math.max(12, obj.width - landingWidth)
    setSelected(obj.id)
    pushHistory()
    setDragging({
      type: 'return-stair-resize',
      id: obj.id,
      pointerId: event.pointerId,
      part,
      start: {
        x: obj.x,
        y: obj.y,
        width: obj.width,
        rotation: obj.rotation,
        landingWidth,
        leftRunWidth: obj.left_run_width ?? obj.leftRunWidth ?? legacyRunWidth,
        rightRunWidth: obj.right_run_width ?? obj.rightRunWidth ?? legacyRunWidth,
        mirrored: obj.landing_turn === 'right',
      },
    })
  }

  const handleDragMove: EditablePointerHandler = (event) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return

    if (dragging.type === 'wall-height') {
      event.stopPropagation()
      const deltaMeters = (dragging.startClientY - event.clientY) * 0.01
      updateWall(dragging.id, {
        height: clamp(roundTo(dragging.startHeight + deltaMeters, 0.01), 1, 5),
      })
      return
    }

    if (dragging.type === 'opening-height') {
      event.stopPropagation()
      const opening = openings.find(o => o.id === dragging.id)
      if (!opening) return
      const deltaMeters = (dragging.startClientY - event.clientY) * 0.01
      const limits = opening.type === 'window'
        ? { min: 0.3, max: 2.6 }
        : opening.type === 'door'
          ? { min: 1, max: 3.5 }
          : { min: 0.4, max: 3.5 }
      updateOpening(dragging.id, {
        height: clamp(roundTo(dragging.startHeight + deltaMeters, 0.01), limits.min, limits.max),
      })
      return
    }

    const point = getGroundPoint(event)
    if (!point) return
    event.stopPropagation()

    if (dragging.type === 'object') {
      updateObject(dragging.id, {
        x: snapTo(point.x / PX + dragging.offsetX, gridSize),
        y: snapTo(point.z / PX + dragging.offsetZ, gridSize),
      })
      return
    }

    if (dragging.type === 'wall-endpoint') {
      updateWall(dragging.id, {
        [dragging.endpoint]: {
          x: roundTo(point.x / PX, 1),
          y: roundTo(point.z / PX, 1),
        },
      })
      return
    }

    if (dragging.type === 'object-resize') {
      const start = dragging.start
      const angle = (start.rotation * Math.PI) / 180
      const dx = point.x / PX - start.x
      const dz = point.z / PX - start.y
      const dragged = {
        x: dx * Math.cos(angle) + dz * Math.sin(angle),
        z: -dx * Math.sin(angle) + dz * Math.cos(angle),
      }
      const oppositeByCorner: Record<ResizeCorner, { x: number; z: number }> = {
        nw: { x: start.width / 2, z: start.height / 2 },
        ne: { x: -start.width / 2, z: start.height / 2 },
        sw: { x: start.width / 2, z: -start.height / 2 },
        se: { x: -start.width / 2, z: -start.height / 2 },
      }
      const opposite = oppositeByCorner[dragging.corner]
      const width = Math.max(20, Math.abs(dragged.x - opposite.x))
      const height = Math.max(20, Math.abs(dragged.z - opposite.z))
      const centerLocal = {
        x: (dragged.x + opposite.x) / 2,
        z: (dragged.z + opposite.z) / 2,
      }
      updateObject(dragging.id, {
        x: roundTo(start.x + centerLocal.x * Math.cos(angle) - centerLocal.z * Math.sin(angle), 1),
        y: roundTo(start.y + centerLocal.x * Math.sin(angle) + centerLocal.z * Math.cos(angle), 1),
        width: Math.max(20, roundTo(width, 1)),
        height: Math.max(20, roundTo(height, 1)),
      })
      return
    }

    if (dragging.type === 'return-stair-resize') {
      const start = dragging.start
      const angle = (start.rotation * Math.PI) / 180
      const dx = point.x / PX - start.x
      const dz = point.z / PX - start.y
      const pointerX = dx * Math.cos(angle) + dz * Math.sin(angle)
      const outerX = start.mirrored ? -start.width / 2 : start.width / 2
      const landingJoinX = start.mirrored
        ? outerX + start.landingWidth
        : outerX - start.landingWidth
      let landingWidth = start.landingWidth
      let leftRunWidth = start.leftRunWidth
      let rightRunWidth = start.rightRunWidth

      if (dragging.part === 'landing') {
        landingWidth = Math.max(
          30,
          start.mirrored ? landingJoinX - pointerX : pointerX - landingJoinX,
        )
      } else {
        const runWidth = Math.max(
          12,
          start.mirrored ? pointerX - landingJoinX : landingJoinX - pointerX,
        )
        if (dragging.part === 'left') leftRunWidth = runWidth
        else rightRunWidth = runWidth
      }

      const nextWidth = landingWidth + Math.max(leftRunWidth, rightRunWidth)
      const widthDelta = nextWidth - start.width
      const localCenterShift = dragging.part === 'landing'
        ? (start.mirrored ? -widthDelta / 2 : widthDelta / 2)
        : (start.mirrored ? widthDelta / 2 : -widthDelta / 2)

      updateObject(dragging.id, {
        x: roundTo(start.x + localCenterShift * Math.cos(angle), 1),
        y: roundTo(start.y + localCenterShift * Math.sin(angle), 1),
        width: roundTo(nextWidth, 1),
        landing_width: roundTo(landingWidth, 1),
        left_run_width: roundTo(leftRunWidth, 1),
        right_run_width: roundTo(rightRunWidth, 1),
      })
      return
    }

    if (dragging.type === 'opening-resize') {
      const opening = openings.find(o => o.id === dragging.id)
      const wall = walls.find(w => w.id === dragging.wallId)
      if (!opening || !wall) return
      const center = openingCenter(wall, opening)
      const alongPoint = projectPointAlongWall(point.x, point.z, wall)
      const alongCenter = projectPointAlongWall(center.x, center.z, wall)
      const maxWidth = Math.max(20, wallLength(wall) * 0.9)
      const minWidth = opening.type === 'door' ? 50 : opening.type === 'gate' ? 40 : 20
      updateOpening(opening.id, {
        width: roundTo(Math.min(maxWidth, Math.max(minWidth, Math.abs(alongPoint - alongCenter) * 2 / PX)), 1),
        ...(opening.type === 'door'
          ? { door_style: opening.door_style ?? 'hinged' }
          : {}),
      })
      return
    }

    const opening = openings.find(o => o.id === dragging.id)
    const wall = walls.find(w => w.id === dragging.wallId)
    if (!opening || !wall) return
    updateOpening(opening.id, {
      offset: projectPointToWallOffset(point.x, point.z, wall, opening.width),
    })
  }

  const handleDragEnd: EditablePointerHandler = (event) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return
    event.stopPropagation()
    setDragging(null)
  }

  return (
    <>
      <color attach="background" args={['#f8f7f3']} />
      <fog attach="fog" args={['#f8f7f3', 28, 95]} />
      <ambientLight intensity={0.95} />
      <directionalLight
        position={[12, 18, 10]}
        intensity={0.95}
      />
      <directionalLight position={[-10, 8, -8]} intensity={0.32} />
      <hemisphereLight args={['#ffffff', '#d6c6ad', 0.72]} />

      <group onPointerMove={handleDragMove} onPointerUp={handleDragEnd} onPointerCancel={handleDragEnd}>
        <Floor walls={walls} />
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {walls.map(w => {
          const lowerOuterWall = wallBounds && isOuterWall(w, wallBounds)
          return (
            <Wall3D
              key={w.id}
              wall={w}
              walls={walls}
              openings={openings}
              outer={Boolean(lowerOuterWall)}
              renderHeight={w.height}
              selected={selectedId === w.id}
              onPointerDown={handleWallPointerDown(w)}
            />
          )
        })}
        {openings.map(o => {
          const wall = walls.find(w => w.id === o.wall_id)
          if (!wall) return null
          const selected = selectedId === o.id
          const onPointerDown = handleOpeningPointerDown(o)
          if (o.type === 'gate') return <Gate3D key={o.id} wall={wall} opening={o} selected={selected} onPointerDown={onPointerDown} />
          if (o.type === 'door') return <DoorFrame3D key={o.id} wall={wall} opening={o} selected={selected} onPointerDown={onPointerDown} />
          return <WindowFrame3D key={o.id} wall={wall} opening={o} selected={selected} onPointerDown={onPointerDown} />
        })}
        {objects.map(o => (
          <Object3D
            key={o.id}
            obj={o}
            selected={selectedId === o.id}
            onPointerDown={handleObjectPointerDown(o)}
          />
        ))}
        {editEnabled && walls.map(w => (
          selectedId === w.id
            ? (
              <WallResizeHandles
                key={`wall-resize-${w.id}`}
                wall={w}
                onHandlePointerDown={(endpoint) => handleWallEndpointPointerDown(w, endpoint)}
                onHeightPointerDown={handleWallHeightPointerDown(w)}
              />
            )
            : null
        ))}
        {editEnabled && openings.map(o => {
          if (selectedId !== o.id) return null
          const wall = walls.find(w => w.id === o.wall_id)
          if (!wall) return null
          return (
            <OpeningResizeHandle
              key={`opening-resize-${o.id}`}
              wall={wall}
              opening={o}
              onPointerDown={handleOpeningResizePointerDown(o)}
              onHeightPointerDown={handleOpeningHeightPointerDown(o)}
            />
          )
        })}
        {editEnabled && objects.map(o => (
          selectedId === o.id
            ? (
              <ObjectResizeHandles
                key={`object-resize-${o.id}`}
                obj={o}
                onHandlePointerDown={(corner) => handleObjectResizePointerDown(o, corner)}
                onReturnPartPointerDown={(part) => handleReturnStairResizePointerDown(o, part)}
              />
            )
            : null
        ))}
      </group>

      <CameraInit walls={walls} />
      <VideoRecorder3D walls={walls} />
      <OrbitControls
        key={isPanTool ? 'pan-controls' : 'orbit-controls'}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enabled={!dragging}
        enablePan
        enableRotate
        screenSpacePanning
        mouseButtons={{
          LEFT: isPanTool ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
          MIDDLE: isPanTool ? THREE.MOUSE.ROTATE : THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
        minDistance={0.4}
        maxDistance={120}
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
      />

      {isEmpty && <gridHelper args={[20, 20, '#2a2f3a', '#252932']} />}
      {isEmpty && <axesHelper args={[2]} />}
    </>
  )
}

// ─── Empty state hint ────────────────────────────────────────────────────────

function EmptyHint() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="text-center">
        <div className="text-5xl mb-3 opacity-20">🏠</div>
        <p className="text-gray-600 text-sm">Draw walls in 2D view</p>
        <p className="text-gray-700 text-xs mt-1">Add doors & windows to see openings in 3D</p>
      </div>
    </div>
  )
}

function WindowStyleThumb({ style, active }: { style: WindowStyle; active: boolean }) {
  const stroke = active ? '#ffffff' : '#111827'
  const glass = active ? '#dff7ff' : '#bfe7f2'
  const faint = active ? 'rgba(255,255,255,0.78)' : '#6b7280'
  const isGrid = style === 'double_hung' || style === 'single_hung' || style === 'cottage' || style === 'french' || style === 'palladian'
  const isSlider = style === 'two_panel_slider' || style === 'three_panel_slider'
  const isProjection = style === 'bay' || style === 'bow' || style === 'garden' || style === 'oriel'
  const isArch = style === 'lunette' || style === 'radius' || style === 'palladian'

  return (
    <svg width="28" height="22" viewBox="0 0 28 22" aria-hidden="true" className="shrink-0">
      {style === 'round' ? (
        <>
          <circle cx="14" cy="11" r="8" fill={glass} stroke={stroke} strokeWidth="2" />
          <path d="M6 11h16M14 3v16" stroke={stroke} strokeWidth="1.2" />
        </>
      ) : isProjection ? (
        <>
          <path d="M4 6h20v12H4z" fill={glass} stroke={stroke} strokeWidth="1.7" />
          <path d="M4 6l4-3h12l4 3M4 18l4 2h12l4-2M10 6v12M18 6v12" fill="none" stroke={stroke} strokeWidth="1.2" />
        </>
      ) : isArch ? (
        <>
          <path d="M5 18V9a9 9 0 0 1 18 0v9z" fill={glass} stroke={stroke} strokeWidth="1.7" />
          <path d="M14 2v16M6 11h16" stroke={stroke} strokeWidth="1.1" />
        </>
      ) : style === 'glass_block' ? (
        <>
          <rect x="3" y="4" width="22" height="15" fill={glass} stroke={stroke} strokeWidth="1.5" />
          {[8, 13, 18].map(x => <path key={x} d={`M${x} 4v15`} stroke={faint} strokeWidth="1" />)}
          {[9, 14].map(y => <path key={y} d={`M3 ${y}h22`} stroke={faint} strokeWidth="1" />)}
        </>
      ) : style === 'jalousie' ? (
        <>
          <rect x="5" y="3" width="18" height="16" fill={glass} stroke={stroke} strokeWidth="1.6" />
          {[7, 10, 13, 16].map(y => <path key={y} d={`M6 ${y}l16-2`} stroke={stroke} strokeWidth="1.1" />)}
        </>
      ) : style === 'awning' || style === 'hopper' || style === 'egress' ? (
        <>
          <rect x="5" y="4" width="18" height="15" fill={glass} stroke={stroke} strokeWidth="1.6" />
          <path d={style === 'hopper' ? 'M6 17l16-4' : 'M6 8l16 4'} stroke={stroke} strokeWidth="1.4" />
        </>
      ) : isSlider ? (
        <>
          <rect x="3" y="5" width="22" height="13" fill={glass} stroke={stroke} strokeWidth="1.6" />
          <path d="M14 5v13" stroke={stroke} strokeWidth="1.3" />
          {style === 'three_panel_slider' && <path d="M9 5v13M19 5v13" stroke={stroke} strokeWidth="1" />}
        </>
      ) : (
        <>
          <rect x="5" y="3" width="18" height="16" fill={glass} stroke={stroke} strokeWidth="1.7" />
          {(isGrid || style === 'casement' || style === 'center_pivot' || style === 'tilt_turn' || style === 'storm') && <path d="M14 3v16" stroke={stroke} strokeWidth="1.1" />}
          {(isGrid || style === 'transom' || style === 'center_pivot') && <path d="M5 11h18" stroke={stroke} strokeWidth="1.1" />}
          {style === 'skylight' && <path d="M8 16l12-10" stroke={faint} strokeWidth="1.2" />}
        </>
      )}
    </svg>
  )
}

function WindowStylePicker() {
  const selectedId = useFloorPlanStore(s => s.selectedId)
  const openings = useFloorPlanStore(s => s.openings)
  const updateOpening = useFloorPlanStore(s => s.updateOpening)
  const pushHistory = useFloorPlanStore(s => s.pushHistory)
  const selectedWindow = openings.find(o => o.id === selectedId && o.type === 'window')

  if (!selectedWindow) return null

  const activeStyle = selectedWindow.window_style ?? 'double_hung'

  return (
    <div
      className="absolute left-1/2 top-3 z-10 flex max-h-28 w-[min(92%,780px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 overflow-y-auto rounded-md border border-gray-200 bg-white/92 px-2 py-1.5 shadow-lg backdrop-blur"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {WINDOW_STYLE_OPTIONS.map(option => {
        const active = activeStyle === option.value
        return (
          <button
            key={option.value}
            type="button"
            className={`flex h-9 items-center gap-1.5 rounded px-2 text-xs font-medium transition ${active ? 'bg-gray-950 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`}
            onClick={() => {
              if (active) return
              pushHistory()
              updateOpening(selectedWindow.id, { window_style: option.value })
            }}
          >
            <WindowStyleThumb style={option.value} active={active} />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function DoorStateButton() {
  const selectedId = useFloorPlanStore(s => s.selectedId)
  const openings = useFloorPlanStore(s => s.openings)
  const updateOpening = useFloorPlanStore(s => s.updateOpening)
  const pushHistory = useFloorPlanStore(s => s.pushHistory)
  const selectedDoor = openings.find(o => o.id === selectedId && o.type === 'door' && o.door_style !== 'opening')

  if (!selectedDoor) return null

  const isOpen = selectedDoor.door_open ?? true

  return (
    <div
      className="absolute right-3 top-3 z-10 rounded-md border border-gray-200 bg-white/92 p-1.5 shadow-lg backdrop-blur"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`h-9 rounded px-3 text-xs font-semibold transition ${isOpen ? 'bg-gray-950 text-white shadow-sm hover:bg-gray-800' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}
        onClick={() => {
          pushHistory()
          updateOpening(selectedDoor.id, { door_open: !isOpen })
        }}
      >
        {isOpen ? 'Close door' : 'Open door'}
      </button>
    </div>
  )
}

export default function Viewer3D() {
  const walls = useFloorPlanStore(s => s.walls)
  const [spacePan, setSpacePan] = useState(false)

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      return element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA'
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (e.code !== 'Space' && e.key !== ' ') return
      e.preventDefault()
      setSpacePan(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      e.preventDefault()
      setSpacePan(false)
    }
    const resetSpacePan = () => setSpacePan(false)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', resetSpacePan)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', resetSpacePan)
    }
  }, [])

  return (
    <div className="w-full h-full relative" onContextMenu={(e) => e.preventDefault()}>
      <Canvas
        camera={{ position: [8, 10, 12], fov: 55, near: 0.1, far: 500 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}>
        <Suspense fallback={null}>
          <Scene spacePan={spacePan} />
        </Suspense>
      </Canvas>
      <WindowStylePicker />
      <DoorStateButton />
      {walls.length === 0 && <EmptyHint />}
    </div>
  )
}
