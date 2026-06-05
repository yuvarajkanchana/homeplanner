import { useRef, useMemo, useEffect, useState, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useFloorPlanStore } from '../../store/useFloorPlanStore'
import type { Wall, Opening, PlacedObject } from '../../types/schema'

const PX = 0.02  // 50px = 1 metre
const DEFAULT_OUTER_WALL_COLOR = '#9db2bd'
const DEFAULT_INNER_WALL_COLOR = '#eee8dc'
const WALL_CAP_COLOR = '#fbf8f0'
const WALL_TRIM_COLOR = '#e9dfcf'
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

function premiumWallColor(color: string | undefined, outer = false) {
  const base = new THREE.Color(color || (outer ? DEFAULT_OUTER_WALL_COLOR : DEFAULT_INNER_WALL_COLOR))
  const hsl = { h: 0, s: 0, l: 0 }
  base.getHSL(hsl)

  if (color) {
    hsl.s = Math.min(hsl.s, outer ? 0.28 : 0.18)
    hsl.l = outer ? Math.max(0.64, Math.min(0.78, hsl.l + 0.08)) : Math.max(0.76, Math.min(0.9, hsl.l + 0.12))
  }

  const graded = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l)
  return graded.lerp(new THREE.Color(outer ? '#dfe6e5' : '#f7f1e7'), outer ? 0.18 : 0.12).getStyle()
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

// Build wall geometry with opening cuts as separate box meshes
// Returns array of {x, z, length, angle, yOffset, height} segments
function buildWallSegments(wall: Wall, openings: Opening[], renderHeight = wall.height) {
  const len = wallLength(wall)
  const angle = wallAngle(wall)
  const height = renderHeight
  const thick = Math.max(wall.thickness * PX, 0.08)

  const wallOpenings = openings
    .filter(o => o.wall_id === wall.id)
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
      const halfT = (o.width / 2) / len
      const t0 = Math.max(0, o.offset - halfT)
      const t1 = Math.min(1, o.offset + halfT)

      // Segment before opening
      if (cursor < t0) {
        segments.push({ t0: cursor, t1: t0, yBottom: 0, yTop: height })
      }

      // For windows: add segment below and above
      if (o.type === 'window') {
        const winBottom = 0.9  // sill height
        const winTop = winBottom + (o.width * PX * 1.2)  // window height
        segments.push({ t0, t1, yBottom: 0, yTop: winBottom })
        if (winTop < height) {
          segments.push({ t0, t1, yBottom: winTop, yTop: height })
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
    const startExtend = t0 === 0 ? thick / 2 : 0
    const endExtend = t1 === 1 ? thick / 2 : 0
    const segLen = baseLen + startExtend + endExtend
    const midT = (t0 + t1) / 2
    const alongX = Math.cos(angle)
    const alongZ = Math.sin(angle)
    const capOffset = (endExtend - startExtend) / 2
    const cx = (wall.start.x + (wall.end.x - wall.start.x) * midT) * PX + alongX * capOffset
    const cz = (wall.start.y + (wall.end.y - wall.start.y) * midT) * PX + alongZ * capOffset
    const segH = yTop - yBottom
    const cy = yBottom + segH / 2
    return { cx, cy, cz, segLen, segH, thick, angle }
  })
}

// ─── Wall3D ──────────────────────────────────────────────────────────────────

function Wall3D({ wall, openings, renderHeight, outer }: { wall: Wall; openings: Opening[]; renderHeight?: number; outer?: boolean }) {
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

  const segments = useMemo(() => buildWallSegments(wall, openings, renderHeight), [
    wall.start.x, wall.start.y, wall.end.x, wall.end.y,
    wall.thickness, wall.height, renderHeight,
    openingSignature,
  ])
  const wallColor = premiumWallColor(wall.color, outer)

  return (
    <>
      {segments.map((s, i) => {
        if (s.segLen < 0.01) return null
        return (
          <mesh
            key={i}
            position={[s.cx, s.cy, s.cz]}
            rotation={[0, -s.angle, 0]}
          >
            <boxGeometry args={[s.segLen, s.segH, s.thick]} />
            <meshStandardMaterial color={wallColor} roughness={0.96} metalness={0} />
          </mesh>
        )
      })}
      {segments.map((s, i) => {
        if (s.segLen < 0.01) return null
        return (
          <mesh
            key={`cap-${i}`}
            position={[s.cx, s.cy + s.segH / 2 + 0.025, s.cz]}
            rotation={[0, -s.angle, 0]}
          >
            <boxGeometry args={[s.segLen + 0.025, 0.05, s.thick + 0.04]} />
            <meshStandardMaterial color={WALL_CAP_COLOR} roughness={0.9} metalness={0} />
          </mesh>
        )
      })}
      {segments.map((s, i) => {
        if (s.segLen < 0.01 || s.segH < 0.35) return null
        return (
          <mesh
            key={`trim-${i}`}
            position={[s.cx, Math.max(0.08, s.cy - s.segH / 2 + 0.11), s.cz]}
            rotation={[0, -s.angle, 0]}
          >
            <boxGeometry args={[s.segLen + 0.01, 0.08, s.thick + 0.055]} />
            <meshStandardMaterial color={outer ? WALL_CAP_COLOR : WALL_TRIM_COLOR} roughness={0.92} metalness={0} />
          </mesh>
        )
      })}
    </>
  )
}

// ─── Door frame 3D ───────────────────────────────────────────────────────────

function DoorFrame3D({ wall, opening }: { wall: Wall; opening: Opening }) {
  const angle = opening.rotation !== undefined ? (opening.rotation * Math.PI) / 180 : wallAngle(wall)
  const len = wallLength(wall)
  const thick = Math.max(wall.thickness * PX, 0.12)
  const doorW = opening.width * PX
  const doorH = opening.height ?? 2.1
  const elevation = opening.elevation ?? 0
  const trim = opening.trim ?? 0.08
  const frameColor = opening.frame_color ?? '#111827'
  const panelColor = opening.panel_color ?? '#ffffff'
  const swingAngle = opening.swing_angle ?? 90
  const doorStyle = opening.door_style ?? 'hinged'
  const mount = opening.mount ?? 'center'
  const mountOffset = mount === 'interior' ? -thick / 2 : mount === 'exterior' ? thick / 2 : 0

  const cx = (wall.start.x + (wall.end.x - wall.start.x) * opening.offset) * PX
  const cz = (wall.start.y + (wall.end.y - wall.start.y) * opening.offset) * PX

  const frameThick = 0.05
  const frameDepth = thick + 0.02

  return (
    <group position={[cx, elevation, cz]} rotation={[0, -angle, 0]}>
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
          swingAngle={doorStyle === 'sliding' ? 0 : swingAngle}
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
  const hingeX = swing === 'left' ? -(doorW / 2) : doorW / 2
  const swingMult = swing === 'left' ? 1 : -1
  const directionMult = swingDirection === 'out' ? -1 : 1
  const panelCount = doorStyle === 'double' ? 2 : 1

  if (doorStyle === 'sliding') {
    return (
      <group position={[0, 0, mountOffset]}>
        <mesh position={[-doorW / 4, doorH / 2, -frameDepth / 4]}>
          <boxGeometry args={[doorW / 2, doorH, 0.04]} />
          <meshStandardMaterial color={panelColor} roughness={0.6} metalness={0.05} />
        </mesh>
        <mesh position={[doorW / 4, doorH / 2, frameDepth / 4]}>
          <boxGeometry args={[doorW / 2, doorH, 0.04]} />
          <meshStandardMaterial color={panelColor} roughness={0.6} metalness={0.05} />
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

function Gate3D({ wall, opening }: { wall: Wall; opening: Opening }) {
  const angle = opening.rotation !== undefined ? (opening.rotation * Math.PI) / 180 : wallAngle(wall)
  const thick = Math.max(wall.thickness * PX, 0.12)
  const gateW = opening.width * PX
  const gateH = opening.height ?? 1.45
  const frameColor = opening.frame_color ?? '#111827'
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
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]}>
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

function WindowFrame3D({ wall, opening }: { wall: Wall; opening: Opening }) {
  const angle = wallAngle(wall)
  const thick = Math.max(wall.thickness * PX, 0.12)
  const winW = opening.width * PX
  const winBottom = 0.9
  const winH = winW * 1.2
  const winMidY = winBottom + winH / 2

  const cx = (wall.start.x + (wall.end.x - wall.start.x) * opening.offset) * PX
  const cz = (wall.start.y + (wall.end.y - wall.start.y) * opening.offset) * PX

  const frameT = 0.055
  const sashT = 0.028
  const casingT = 0.045
  const depth = thick + 0.055
  const glassZ = -depth / 2 - 0.012
  const frameColor = '#f8f4ec'
  const sashColor = '#eef0eb'
  const revealColor = '#2e3236'
  const glassColor = '#1f3345'
  const sillColor = '#f4ead8'
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
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]}>
      {bar('reveal-back', [0, winMidY, -depth / 2], [winW + frameT * 2.7, winH + frameT * 2.7, 0.035], revealColor, 0.74)}

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

      {[-1, 1].map(side => bar(
        `casing-side-${side}`,
        [side * (winW / 2 + frameT + casingT / 2), winMidY, -depth / 2 - 0.02],
        [casingT, winH + frameT * 2.9, 0.075],
        frameColor,
      ))}
      {[-1, 1].map(side => bar(
        `casing-rail-${side}`,
        [0, winMidY + side * (winH / 2 + frameT + casingT / 2), -depth / 2 - 0.02],
        [winW + frameT * 2.9, casingT, 0.075],
        frameColor,
      ))}

      <mesh position={[0, winMidY, glassZ]}>
        <boxGeometry args={[Math.max(0.08, winW - sashT * 2), Math.max(0.08, winH - sashT * 2), 0.014]} />
        <meshStandardMaterial
          color={glassColor}
          transparent
          opacity={0.82}
          roughness={0.18}
          metalness={0.18}
        />
      </mesh>

      {bar('center-horizontal-sash', [0, winMidY, glassZ - 0.012], [winW - frameT * 0.8, sashT, 0.045], sashColor, 0.5)}
      {bar('center-vertical-sash', [0, winMidY, glassZ - 0.012], [sashT, winH - frameT * 0.8, 0.045], sashColor, 0.5)}
      {bar('top-highlight', [0, winMidY + winH * 0.28, glassZ - 0.025], [winW * 0.62, 0.012, 0.012], '#ffffff', 0.3)}
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
}

function Object3D({ obj }: { obj: PlacedObject }) {
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

  if (obj.type === 'bed' || obj.type === 'bed_s') {
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
      const landingW = Math.min(w * 0.34, Math.max(0.48, (obj.landing_width ?? 80) * PX))
      const runW = Math.max(0.36, w - landingW)
      const runD = Math.min(Math.max(0.3, (obj.landing_depth ?? 80) * PX), Math.max(0.3, (d - 0.16) / 2))
      const firstSteps = Math.max(3, Math.floor(stepCount / 2))
      const secondSteps = Math.max(3, stepCount - firstSteps)
      const midH = stairHeight * 0.5
      const landingX = w / 2 - landingW / 2
      const lowerZ = d / 2 - runD / 2
      const upperZ = -d / 2 + runD / 2
      const railH = 0.78
      const landingPost = (key: string, xPos: number, zPos: number) =>
        rail(key, [xPos, midH + railH / 2 + 0.08, zPos], [0.05, railH, 0.05])
      contents = (
        <>
          {renderRun('return-lower-run', -w / 2, lowerZ, runW, runD, 0, midH, firstSteps, 'x')}
          {box('return-mid-landing', [landingX, midH + 0.04, 0], [landingW, 0.08, d], landingColor)}
          {renderRun('return-upper-run', w / 2 - landingW, upperZ, runW, runD, midH, stairHeight, secondSteps, 'x', railColor, -1)}
          {landingPost('return-landing-post-a', w / 2 - 0.055, d / 2 - 0.055)}
          {landingPost('return-landing-post-b', w / 2 - 0.055, -d / 2 + 0.055)}
          {landingPost('return-landing-post-c', w / 2 - landingW + 0.055, d / 2 - 0.055)}
          {landingPost('return-landing-post-d', w / 2 - landingW + 0.055, -d / 2 + 0.055)}
          {rail('return-landing-outer-rail', [w / 2 - 0.055, midH + railH + 0.08, 0], [0.055, 0.055, d], handrailColor)}
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
    <group position={[x, 0, z]} rotation={[0, -(obj.rotation * Math.PI) / 180, 0]}>
      {contents}
    </group>
  )
}

// ─── Camera initializer ──────────────────────────────────────────────────────

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
  const isEmpty = walls.length === 0
  const isPanTool = activeTool === 'pan' || spacePan
  const wallBounds = useMemo(() => walls.length ? getWallBounds(walls) : null, [walls])

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

      <Floor walls={walls} />

      {walls.map(w => {
        const lowerOuterWall = wallBounds && isOuterWall(w, wallBounds)
        return (
          <Wall3D
            key={w.id}
            wall={w}
            openings={openings}
            outer={Boolean(lowerOuterWall)}
            renderHeight={w.height}
          />
        )
      })}
      {openings.map(o => {
        const wall = walls.find(w => w.id === o.wall_id)
        if (!wall) return null
        if (o.type === 'gate') return <Gate3D key={o.id} wall={wall} opening={o} />
        if (o.type === 'door') return <DoorFrame3D key={o.id} wall={wall} opening={o} />
        return <WindowFrame3D key={o.id} wall={wall} opening={o} />
      })}
      {objects.map(o => <Object3D key={o.id} obj={o} />)}

      <CameraInit walls={walls} />
      <VideoRecorder3D walls={walls} />
      <OrbitControls
        key={isPanTool ? 'pan-controls' : 'orbit-controls'}
        makeDefault
        enableDamping
        dampingFactor={0.08}
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
      {walls.length === 0 && <EmptyHint />}
    </div>
  )
}
