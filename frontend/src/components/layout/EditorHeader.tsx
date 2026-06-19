import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Home, Save, ChevronRight, Check, Ruler, ScanLine, Download, Video,
  FileText, FilePlus2, FolderOpen, Printer, ImageDown, Copy, LayoutDashboard,
  Upload, Archive, X, LogOut, Undo2, Redo2, Scissors, ClipboardPaste,
  Trash2, MousePointer2, Magnet, Settings, Search, BrickWall, Fence,
  DoorOpen, Square, Layers3, PanelTop, Frame, Rows4, Warehouse,
  Zap, ImagePlus
} from 'lucide-react'
import { useFloorPlanStore } from '../../store/useFloorPlanStore'
import type { Opening, PlacedObject, Wall } from '../../types/schema'
import { api } from '../../api/client'
import toast from 'react-hot-toast'
import { captureAndStoreProjectThumbnail } from '../../utils/projectThumbnails'

interface Props {
  projectId: string
  projectName: string
  view: '2d' | '3d' | 'split'
  onViewChange: (v: '2d' | '3d' | 'split') => void
}
type SaveAsFormat = 'pdf' | 'word' | 'image'
type FilePickerAccept = Record<string, string[]>
type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<{ name?: string }>
}
type EditorClipboard =
  | { type: 'wall'; item: Wall }
  | { type: 'opening'; item: Opening }
  | { type: 'object'; item: PlacedObject }
type BuildSubmenu = 'wall' | 'railing' | 'fencing' | 'door' | 'window' | 'floor' | 'roof' | 'slab' | 'stairs'

const BUILD_SUBMENU_LABELS: Record<BuildSubmenu, string> = {
  wall: 'Wall',
  railing: 'Railing and Deck',
  fencing: 'Fencing',
  door: 'Door',
  window: 'Window',
  floor: 'Floor',
  roof: 'Roof',
  slab: 'Slab',
  stairs: 'Stairs',
}
const BUILD_SUBMENU_ITEMS: Record<BuildSubmenu, Array<{ label: string; preset: string; shortcut?: string }>> = {
  wall: [
    { label: 'Straight Exterior Wall', preset: 'straight-exterior-wall', shortcut: 'W' },
    { label: 'Curved Exterior Wall', preset: 'curved-exterior-wall' },
    { label: 'Straight Interior Wall', preset: 'straight-interior-wall' },
    { label: 'Curved Interior Wall', preset: 'curved-interior-wall' },
    { label: 'Straight Foundation Wall', preset: 'straight-foundation-wall' },
    { label: 'Curved Foundation Wall', preset: 'curved-foundation-wall' },
    { label: 'Straight Pony Wall', preset: 'straight-pony-wall' },
    { label: 'Curved Pony Wall', preset: 'curved-pony-wall' },
    { label: 'Straight Glass Wall', preset: 'straight-glass-wall' },
    { label: 'Straight Glass Pony Wall', preset: 'straight-glass-pony-wall' },
    { label: 'Straight Half-Wall', preset: 'straight-half-wall' },
    { label: 'Curved Half-Wall', preset: 'curved-half-wall' },
    { label: 'Room Divider', preset: 'room-divider' },
    { label: 'Wall Hatching', preset: 'wall-hatching' },
    { label: 'Fix Wall Connections', preset: 'fix-wall-connections' },
    { label: 'Define Wall Types...', preset: 'define-wall-types' },
  ],
  railing: [
    { label: 'Straight Railing', preset: 'straight-railing' },
    { label: 'Curved Railing', preset: 'curved-railing' },
    { label: 'Straight Deck Railing', preset: 'straight-deck-railing' },
    { label: 'Curved Deck Railing', preset: 'curved-deck-railing' },
    { label: 'Straight Deck Edge', preset: 'straight-deck-edge' },
    { label: 'Curved Deck Edge', preset: 'curved-deck-edge' },
    { label: 'Polygon Shaped Deck...', preset: 'polygon-deck' },
  ],
  fencing: [
    { label: 'Straight Fencing', preset: 'straight-fencing' },
    { label: 'Curved Fencing', preset: 'curved-fencing' },
  ],
  door: [
    { label: 'Hinged Door', preset: 'hinged-door', shortcut: 'Shift+E' },
    { label: 'Doorway', preset: 'doorway' },
    { label: 'Sliding Door', preset: 'sliding-door' },
    { label: 'Pocket Door', preset: 'pocket-door' },
    { label: 'Bifold Door', preset: 'bifold-door' },
    { label: 'Garage Door', preset: 'garage-door' },
    { label: 'Fixed Door', preset: 'fixed-door' },
    { label: 'Barn Door', preset: 'barn-door' },
    { label: 'Shower Door', preset: 'shower-door' },
  ],
  window: [
    { label: 'Window', preset: 'window', shortcut: 'Shift+W' },
    { label: 'Bay Window', preset: 'bay-window' },
    { label: 'Box Window', preset: 'box-window' },
    { label: 'Bow Window', preset: 'bow-window' },
    { label: 'Pass-Through', preset: 'pass-through' },
    { label: 'Wall Niche', preset: 'wall-niche' },
  ],
  floor: [
    { label: 'Build New Floor...', preset: 'build-new-floor', shortcut: 'Shift+X' },
    { label: 'Insert New Floor...', preset: 'insert-new-floor' },
    { label: 'Delete Current Floor', preset: 'delete-current-floor' },
    { label: 'Exchange With Floor Above', preset: 'exchange-floor-above' },
    { label: 'Exchange With Floor Below', preset: 'exchange-floor-below' },
    { label: 'Build Foundation...', preset: 'build-foundation', shortcut: 'Ctrl+0' },
    { label: 'Delete Foundation', preset: 'delete-foundation' },
    { label: 'Rebuild Walls/Floors/Ceilings', preset: 'rebuild-shell', shortcut: 'F12' },
  ],
  roof: [
    { label: 'Build Roof...', preset: 'build-roof', shortcut: 'Ctrl+R' },
    { label: 'Roof Plane', preset: 'roof-plane', shortcut: 'Q' },
    { label: 'Ceiling Plane', preset: 'ceiling-plane' },
    { label: 'Gable/Roof Line', preset: 'gable-roof-line' },
    { label: 'Skylight', preset: 'skylight' },
    { label: 'Roof Hole', preset: 'roof-hole' },
    { label: 'Auto Floating Dormer', preset: 'floating-dormer' },
    { label: 'Auto Dormer', preset: 'auto-dormer' },
    { label: 'Delete Roof Planes', preset: 'delete-roof-planes' },
    { label: 'Delete Ceiling Planes', preset: 'delete-ceiling-planes' },
    { label: 'Fix Roofs', preset: 'fix-roofs' },
  ],
  slab: [
    { label: 'Slab', preset: 'slab' },
    { label: 'Slab with Footing', preset: 'slab-with-footing' },
    { label: 'Round Pier', preset: 'round-pier' },
    { label: 'Square Pad', preset: 'square-pad' },
  ],
  stairs: [
    { label: 'Draw Stairs', preset: 'draw-stairs', shortcut: 'Shift+Y' },
    { label: 'Straight Stairs', preset: 'straight-stairs' },
    { label: 'Curve to Left', preset: 'curve-stairs-left' },
    { label: 'Curve to Right', preset: 'curve-stairs-right' },
    { label: 'L-Shaped Stair', preset: 'l-shaped-stair' },
    { label: 'U-Shaped Stair', preset: 'u-shaped-stair' },
    { label: 'Draw Ramp', preset: 'draw-ramp' },
    { label: 'Landing', preset: 'landing' },
  ],
}

const isTypingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  if (!element) return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable
}

export default function EditorHeader({ projectId, projectName, view, onViewChange }: Props) {
  const navigate = useNavigate()
  const {
    isDirty,
    getFloorPlan,
    markClean,
    measurementUnit,
    toggleMeasurementUnit,
    wallMeasurementMode,
    toggleWallMeasurementMode,
    walls,
    openings,
    objects,
    selectedId,
    grid_size,
    setGridSize,
    setBuildPreset,
    setSelected,
    setTool,
    addWall,
    updateWall,
    addOpening,
    addObject,
    updateObject,
    removeWall,
    removeOpening,
    removeObject,
    undo,
    redo,
  } = useFloorPlanStore()
  const [saving, setSaving] = useState(false)
  const [savingAs, setSavingAs] = useState(false)
  const [recording3D, setRecording3D] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [showFileMenu, setShowFileMenu] = useState(false)
  const [showEditMenu, setShowEditMenu] = useState(false)
  const [showBuildMenu, setShowBuildMenu] = useState(false)
  const [buildSubmenu, setBuildSubmenu] = useState<BuildSubmenu | null>(null)
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [saveAsName, setSaveAsName] = useState(`${projectName} Copy`)
  const [saveAsFormat, setSaveAsFormat] = useState<SaveAsFormat>('pdf')
  const fileMenuRef = useRef<HTMLDivElement | null>(null)
  const editMenuRef = useRef<HTMLDivElement | null>(null)
  const buildMenuRef = useRef<HTMLDivElement | null>(null)
  const buildSubmenuTimerRef = useRef<number | null>(null)
  const clipboardRef = useRef<EditorClipboard | null>(null)
  const unitLabel = measurementUnit === 'm' ? 'Meters' : measurementUnit === 'ft' ? 'Feet' : `Feet/In`
  const measurementModeLabel = wallMeasurementMode === 'outer'
    ? 'Outer dims'
    : wallMeasurementMode === 'none'
      ? 'No dims'
      : 'All dims'

  const cancelBuildSubmenuClose = () => {
    if (buildSubmenuTimerRef.current === null) return
    window.clearTimeout(buildSubmenuTimerRef.current)
    buildSubmenuTimerRef.current = null
  }

  const openBuildSubmenu = (submenu: BuildSubmenu) => {
    cancelBuildSubmenuClose()
    setBuildSubmenu(submenu)
  }

  const scheduleBuildSubmenuClose = () => {
    cancelBuildSubmenuClose()
    buildSubmenuTimerRef.current = window.setTimeout(() => {
      setBuildSubmenu(null)
      buildSubmenuTimerRef.current = null
    }, 220)
  }

  useEffect(() => () => cancelBuildSubmenuClose(), [])

  useEffect(() => {
    if (!showFileMenu && !showEditMenu && !showBuildMenu) return
    const closeMenu = (event: MouseEvent) => {
      if (
        fileMenuRef.current?.contains(event.target as Node)
        || editMenuRef.current?.contains(event.target as Node)
        || buildMenuRef.current?.contains(event.target as Node)
      ) return
      setShowFileMenu(false)
      setShowEditMenu(false)
      setShowBuildMenu(false)
      setBuildSubmenu(null)
    }
    window.addEventListener('mousedown', closeMenu)
    return () => window.removeEventListener('mousedown', closeMenu)
  }, [showFileMenu, showEditMenu, showBuildMenu])

  useEffect(() => {
    const handleFileShortcut = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      const commandKey = event.ctrlKey || event.metaKey

      if (!commandKey) return

      if (key === 'x') {
        event.preventDefault()
        cutSelection()
        return
      }
      if (key === 'c') {
        event.preventDefault()
        copySelection()
        return
      }
      if (key === 'v') {
        event.preventDefault()
        pasteSelection(event.shiftKey)
        return
      }
      if (key === 'f') {
        event.preventDefault()
        findReplaceText()
        return
      }

      if (key === 's') {
        event.preventDefault()
        if (event.shiftKey) {
          openSaveAs()
        } else if (!saving && isDirty) {
          void save()
        }
        return
      }

      if (key === 'p') {
        event.preventDefault()
        void printPlan()
        return
      }

      if (key === 'n') {
        event.preventDefault()
        void createNewProject()
      }
    }

    window.addEventListener('keydown', handleFileShortcut)
    return () => window.removeEventListener('keydown', handleFileShortcut)
  })

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/projects/${projectId}/floorplan`, getFloorPlan())
      await captureAndStoreProjectThumbnail(projectId)
      markClean()
      toast.success('Saved')
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const fileSafeName = (name: string) =>
    name.trim().replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ') || 'floor-plan'

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  const requestHighResolutionPlanImage = () =>
    new Promise<{ dataUrl: string; width: number; height: number } | null>((resolve) => {
      const timeout = window.setTimeout(() => resolve(null), 250)
      window.dispatchEvent(new CustomEvent('homeplanner:export-2d', {
        detail: {
          pixelRatio: 4,
          resolve: (image: { dataUrl: string; width: number; height: number }) => {
            window.clearTimeout(timeout)
            resolve(image)
          },
          reject: () => {
            window.clearTimeout(timeout)
            resolve(null)
          },
        },
      }))
    })

  const capturePlanImage = async () => {
    const highResolutionImage = await requestHighResolutionPlanImage()
    if (highResolutionImage) return highResolutionImage

    const konvaContainer = document.querySelector('.konva-container') as HTMLElement | null
    const canvases = konvaContainer
      ? Array.from(konvaContainer.querySelectorAll('canvas'))
      : Array.from(document.querySelectorAll('canvas'))

    const visibleCanvases = canvases.filter((canvas) => canvas.width > 0 && canvas.height > 0)
    if (visibleCanvases.length === 0) return null

    const firstCanvas = visibleCanvases[0]
    const imageCanvas = document.createElement('canvas')
    imageCanvas.width = firstCanvas.width
    imageCanvas.height = firstCanvas.height
    const context = imageCanvas.getContext('2d')
    if (!context) return null

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, imageCanvas.width, imageCanvas.height)
    visibleCanvases.forEach((canvas) => {
      context.drawImage(canvas, 0, 0, imageCanvas.width, imageCanvas.height)
    })

    const fallbackPixelRatio = 2
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = imageCanvas.width * fallbackPixelRatio
    exportCanvas.height = imageCanvas.height * fallbackPixelRatio
    const exportContext = exportCanvas.getContext('2d')
    if (!exportContext) return null
    exportContext.imageSmoothingEnabled = true
    exportContext.imageSmoothingQuality = 'high'
    exportContext.drawImage(imageCanvas, 0, 0, exportCanvas.width, exportCanvas.height)

    return {
      dataUrl: exportCanvas.toDataURL('image/jpeg', 0.98),
      width: exportCanvas.width,
      height: exportCanvas.height,
    }
  }

  const dataUrlToBytes = (dataUrl: string) => {
    const base64 = dataUrl.split(',')[1] ?? ''
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  }

  const dataUrlToBlob = (dataUrl: string) => {
    const mime = dataUrl.match(/^data:(.*?);base64,/)?.[1] ?? 'image/jpeg'
    return new Blob([dataUrlToBytes(dataUrl)], { type: mime })
  }

  const buildPdfBlob = (image: { dataUrl: string; width: number; height: number }) => {
    const encoder = new TextEncoder()
    const imageBytes = dataUrlToBytes(image.dataUrl)
    const maxPageW = 842
    const maxPageH = 1191
    const scale = Math.min(maxPageW / image.width, maxPageH / image.height, 1)
    const pageW = image.width * scale
    const pageH = image.height * scale
    const drawW = image.width * scale
    const drawH = image.height * scale
    const content = [
      'q',
      `${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} 0 0 cm`,
      '/Im1 Do',
      'Q',
    ].join('\n')

    const parts: BlobPart[] = []
    const offsets: number[] = [0]
    let byteOffset = 0
    const addString = (value: string) => {
      const bytes = encoder.encode(value)
      parts.push(bytes)
      byteOffset += bytes.length
    }
    const addObject = (value: string) => {
      offsets.push(byteOffset)
      addString(value)
    }

    addString('%PDF-1.4\n')
    addObject('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    addObject('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
    addObject(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`)
    offsets.push(byteOffset)
    addString(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`)
    parts.push(imageBytes)
    byteOffset += imageBytes.length
    addString('\nendstream\nendobj\n')
    addObject(`5 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream\nendobj\n`)

    const xrefOffset = byteOffset
    addString(`xref\n0 6\n0000000000 65535 f \n`)
    offsets.slice(1).forEach((offset) => {
      addString(`${offset.toString().padStart(10, '0')} 00000 n \n`)
    })
    addString(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)

    return new Blob(parts, { type: 'application/pdf' })
  }

  const buildWordBlob = (name: string, imageDataUrl: string) => {
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(name)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; }
    img { max-width: 100%; height: auto; border: 1px solid #ccc; }
  </style>
</head>
<body>
  <h1>${escapeHtml(name)}</h1>
  <img src="${imageDataUrl}" alt="${escapeHtml(name)} floor plan" />
</body>
</html>`
    return new Blob([html], { type: 'application/msword' })
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const createFileSaver = async (
    filename: string,
    description: string,
    accept: FilePickerAccept
  ): Promise<(blob: Blob, fallbackFilename?: string) => Promise<void>> => {
    const picker = (window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string
        types: Array<{ description: string; accept: FilePickerAccept }>
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>
          close: () => Promise<void>
        }>
      }>
    }).showSaveFilePicker

    if (!picker) {
      return async (blob, fallbackFilename) => downloadBlob(blob, fallbackFilename ?? filename)
    }

    const handle = await picker({
      suggestedName: filename,
      types: [{ description, accept }],
    })

    return async (blob) => {
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    }
  }

  const isCancelError = (error: unknown) =>
    error instanceof DOMException && error.name === 'AbortError'

  const openSaveAs = () => {
    setSaveAsName(projectName)
    setShowFileMenu(false)
    setShowSaveAs(true)
  }

  const createNewProject = async () => {
    setCreatingProject(true)
    setShowFileMenu(false)
    try {
      const { data } = await api.post('/projects/', {
        name: 'New Project',
        description: '',
      })
      toast.success('New project created')
      navigate(`/editor/${data.id}`)
    } catch {
      toast.error('Failed to create project')
    } finally {
      setCreatingProject(false)
    }
  }

  const openFolder = async () => {
    setShowFileMenu(false)
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker
    if (!picker) {
      navigate('/')
      toast('Open folder is not supported here. Showing projects instead.')
      return
    }

    try {
      const folder = await picker()
      toast.success(folder.name ? `Opened ${folder.name}` : 'Folder opened')
    } catch (error) {
      if (!isCancelError(error)) toast.error('Open folder failed')
    }
  }

  const printPlan = async () => {
    setShowFileMenu(false)
    try {
      const image = await capturePlanImage()
      if (!image) {
        toast.error('No plan view found to print')
        return
      }
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        toast.error('Print window was blocked')
        return
      }
      printWindow.document.write(`<!doctype html>
<html>
<head>
  <title>${escapeHtml(projectName)}</title>
  <style>
    body { margin: 0; padding: 24px; background: white; font-family: Arial, sans-serif; }
    h1 { margin: 0 0 16px; font-size: 18px; color: #111; }
    img { max-width: 100%; height: auto; border: 1px solid #ddd; }
    @media print { body { padding: 0; } h1 { margin: 0 0 10px; } img { border: 0; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(projectName)}</h1>
  <img src="${image.dataUrl}" alt="${escapeHtml(projectName)} floor plan" />
</body>
</html>`)
      printWindow.document.close()
      printWindow.addEventListener('load', () => printWindow.print(), { once: true })
    } catch {
      toast.error('Print failed')
    }
  }

  const record3DVideo = async () => {
    setRecording3D(true)
    try {
      const filename = `${fileSafeName(projectName)}-3d-view.webm`
      const saveBlob = await createFileSaver(filename, 'WebM video', {
        'video/webm': ['.webm'],
      })

      if (view === '2d') {
        onViewChange('3d')
        await new Promise(resolve => window.setTimeout(resolve, 400))
      }

      await new Promise<void>((resolve, reject) => {
        window.dispatchEvent(new CustomEvent('homeplanner:record-3d', {
          detail: {
            filename,
            durationMs: 30000,
            saveBlob,
            resolve,
            reject,
          },
        }))
      })
      toast.success('3D video saved')
    } catch (error) {
      if (!isCancelError(error)) toast.error('3D video recording failed')
    } finally {
      setRecording3D(false)
    }
  }

  const saveAs = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = saveAsName.trim()
    if (!name) return

    setSavingAs(true)
    try {
      const filename = saveAsFormat === 'pdf'
        ? `${fileSafeName(name)}.pdf`
        : saveAsFormat === 'word'
          ? `${fileSafeName(name)}.doc`
          : `${fileSafeName(name)}.jpg`
      const saveBlob = await createFileSaver(
        filename,
        saveAsFormat === 'pdf' ? 'PDF document' : saveAsFormat === 'word' ? 'Word document' : 'JPEG image',
        saveAsFormat === 'pdf'
          ? { 'application/pdf': ['.pdf'] }
          : saveAsFormat === 'word'
            ? { 'application/msword': ['.doc'] }
            : { 'image/jpeg': ['.jpg', '.jpeg'] }
      )
      const image = await capturePlanImage()
      if (!image) {
        toast.error('No plan view found to export')
        return
      }
      if (saveAsFormat === 'pdf') {
        await saveBlob(buildPdfBlob(image), filename)
      } else if (saveAsFormat === 'word') {
        await saveBlob(buildWordBlob(name, image.dataUrl), filename)
      } else {
        await saveBlob(dataUrlToBlob(image.dataUrl), filename)
      }
      toast.success(`Saved as ${saveAsFormat === 'pdf' ? 'PDF' : saveAsFormat === 'word' ? 'Word' : 'image'} file`)
      setShowSaveAs(false)
    } catch (error) {
      if (!isCancelError(error)) toast.error('Save as failed')
    } finally {
      setSavingAs(false)
    }
  }

  const saveAsImage = () => {
    setSaveAsFormat('image')
    openSaveAs()
  }

  const saveFromMenu = async () => {
    setShowFileMenu(false)
    await save()
  }

  const unavailable = (label: string) => {
    setShowFileMenu(false)
    toast(`${label} is not available in the web edition yet.`)
  }

  const makeProjectCopy = async () => {
    setShowFileMenu(false)
    try {
      const { data } = await api.post('/projects/', {
        name: `${projectName} Copy`,
        description: '',
      })
      await api.put(`/projects/${data.id}/floorplan`, getFloorPlan())
      toast.success('Project copy created')
      navigate(`/editor/${data.id}`)
    } catch {
      toast.error('Could not copy project')
    }
  }

  const exportPlanFile = () => {
    setShowFileMenu(false)
    const blob = new Blob([JSON.stringify(getFloorPlan(), null, 2)], {
      type: 'application/json',
    })
    downloadBlob(blob, `${fileSafeName(projectName)}.homeplanner.json`)
    toast.success('Plan exported')
  }

  const importPlanFile = () => {
    setShowFileMenu(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.homeplanner'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const plan = JSON.parse(await file.text())
        if (!Array.isArray(plan.walls) || !Array.isArray(plan.openings) || !Array.isArray(plan.objects)) {
          throw new Error('Invalid plan')
        }
        useFloorPlanStore.getState().hydrate(plan)
        toast.success('Plan imported')
      } catch {
        toast.error('Invalid HomePlanner file')
      }
    }
    input.click()
  }

  const saveThumbnailImage = async () => {
    setShowFileMenu(false)
    const image = await capturePlanImage()
    if (!image) {
      toast.error('No plan view found')
      return
    }
    downloadBlob(dataUrlToBlob(image.dataUrl), `${fileSafeName(projectName)}-thumbnail.jpg`)
    toast.success('Thumbnail saved')
  }

  const closeCurrentView = () => {
    setShowFileMenu(false)
    if (view === 'split') onViewChange('2d')
    else navigate('/')
  }

  const closeAll3DViews = () => {
    setShowFileMenu(false)
    onViewChange('2d')
  }

  const selectedClipboardItem = (): EditorClipboard | null => {
    const wall = walls.find(item => item.id === selectedId)
    if (wall) return { type: 'wall', item: structuredClone(wall) }
    const opening = openings.find(item => item.id === selectedId)
    if (opening) return { type: 'opening', item: structuredClone(opening) }
    const object = objects.find(item => item.id === selectedId)
    if (object) return { type: 'object', item: structuredClone(object) }
    return null
  }

  const copySelection = () => {
    const item = selectedClipboardItem()
    if (!item) {
      toast('Select an object first')
      return false
    }
    clipboardRef.current = item
    toast.success('Copied')
    return true
  }

  const deleteSelection = () => {
    if (!selectedId) {
      toast('Select an object first')
      return
    }
    if (walls.some(item => item.id === selectedId)) removeWall(selectedId)
    else if (openings.some(item => item.id === selectedId)) removeOpening(selectedId)
    else if (objects.some(item => item.id === selectedId)) removeObject(selectedId)
    setSelected(null)
  }

  const cutSelection = () => {
    if (!copySelection()) return
    deleteSelection()
  }

  const pasteSelection = (inPlace = false) => {
    const clipboard = clipboardRef.current
    if (!clipboard) {
      toast('Nothing has been copied')
      return
    }
    const offset = inPlace ? 0 : grid_size
    if (clipboard.type === 'wall') {
      const { id: _id, ...wall } = clipboard.item
      const next = addWall({
        ...wall,
        start: { x: wall.start.x + offset, y: wall.start.y + offset },
        end: { x: wall.end.x + offset, y: wall.end.y + offset },
      })
      setSelected(next.id)
    } else if (clipboard.type === 'opening') {
      const { id: _id, ...opening } = clipboard.item
      if (!walls.some(wall => wall.id === opening.wall_id)) {
        toast.error('The original wall no longer exists')
        return
      }
      addOpening({
        ...opening,
        offset: Math.max(0.05, Math.min(0.95, opening.offset + (inPlace ? 0 : 0.05))),
      })
    } else {
      const { id: _id, ...object } = clipboard.item
      const next = addObject({
        ...object,
        x: object.x + offset,
        y: object.y + offset,
      })
      setSelected(next.id)
    }
    toast.success(inPlace ? 'Pasted in place' : 'Pasted')
  }

  const findReplaceText = () => {
    setShowEditMenu(false)
    const find = window.prompt('Find text')
    if (!find) return
    const matches = objects.filter(object =>
      object.type === 'text' && object.label.toLowerCase().includes(find.toLowerCase())
    )
    if (matches.length === 0) {
      toast('No matching text found')
      return
    }
    const replacement = window.prompt(`Replace "${find}" with`, find)
    if (replacement === null) return
    matches.forEach(object => {
      updateObject(object.id, {
        label: object.label.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replacement),
      })
    })
    toast.success(`Updated ${matches.length} text item${matches.length === 1 ? '' : 's'}`)
  }

  const replaceFonts = () => {
    setShowEditMenu(false)
    const size = Number(window.prompt('New text size in pixels', '16'))
    if (!Number.isFinite(size) || size < 6) return
    const textObjects = objects.filter(object => object.type === 'text')
    textObjects.forEach(object => updateObject(object.id, { font_size: size }))
    toast.success(`Updated ${textObjects.length} text item${textObjects.length === 1 ? '' : 's'}`)
  }

  const cycleSnapGrid = () => {
    const sizes = [5, 10, 20, 25, 50]
    const currentIndex = sizes.indexOf(grid_size)
    const next = sizes[(currentIndex + 1 + sizes.length) % sizes.length]
    setGridSize(next)
    toast.success(`Snap grid: ${next}px`)
  }

  const resetEditorDefaults = () => {
    setGridSize(20)
    setTool('select')
    setSelected(null)
    setShowEditMenu(false)
    toast.success('Editor defaults restored')
  }

  const openPreferences = () => {
    setShowEditMenu(false)
    const next = Number(window.prompt('Snap grid size in pixels', String(grid_size)))
    if (!Number.isFinite(next) || next < 1 || next > 200) return
    setGridSize(Math.round(next))
    toast.success('Preferences updated')
  }

  const chooseBuildTool = (
    tool: 'wall' | 'door' | 'doubleDoor' | 'window' | 'stairs' | 'gate' | 'object' | 'text',
    message: string,
    preset?: string,
  ) => {
    setTool(tool)
    setBuildPreset(preset ?? null)
    setShowBuildMenu(false)
    setBuildSubmenu(null)
    toast.success(message)
  }

  const addBuildObject = (
    type: string,
    label: string,
    width: number,
    height: number,
    color: string,
    variant = type,
  ) => {
    const object = addObject({
      type,
      label,
      x: 300,
      y: 220,
      width,
      height,
      rotation: 0,
      color,
      build_variant: variant,
    })
    setSelected(object.id)
    setTool('select')
    setShowBuildMenu(false)
    toast.success(`${label} added`)
  }

  const removeBuildObjects = (predicate: (object: PlacedObject) => boolean, label: string) => {
    const matches = objects.filter(predicate)
    matches.forEach(object => removeObject(object.id))
    toast.success(matches.length ? `${label} removed` : `No ${label.toLowerCase()} found`)
  }

  const runBuildCommand = (submenu: BuildSubmenu, preset: string, label: string) => {
    if (submenu === 'wall') {
      if (preset === 'fix-wall-connections') {
        const tolerance = 10
        walls.forEach((wall, wallIndex) => {
          const endpoints = ['start', 'end'] as const
          endpoints.forEach(endpoint => {
            const point = wall[endpoint]
            const nearby = walls
              .filter((_, index) => index !== wallIndex)
              .flatMap(other => [other.start, other.end])
              .find(candidate => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= tolerance)
            if (nearby) updateWall(wall.id, { [endpoint]: { ...nearby } })
          })
        })
        setShowBuildMenu(false)
        toast.success('Wall connections fixed')
        return
      }
      if (preset === 'define-wall-types') {
        const thickness = Number(window.prompt('Default wall thickness in pixels', '10'))
        if (Number.isFinite(thickness) && thickness >= 4 && thickness <= 60) {
          walls.forEach(wall => updateWall(wall.id, { thickness }))
          toast.success('Wall types updated')
        }
        setShowBuildMenu(false)
        return
      }
      chooseBuildTool('wall', `${label} selected`, preset)
      return
    }

    if (submenu === 'door') {
      chooseBuildTool('door', `${label} selected`, preset)
      return
    }
    if (submenu === 'window') {
      chooseBuildTool('window', `${label} selected`, preset)
      return
    }
    if (submenu === 'fencing') {
      chooseBuildTool('gate', `${label} selected`, preset)
      return
    }
    if (submenu === 'stairs') {
      if (preset === 'landing') {
        addBuildObject('landing', 'Landing', 100, 100, '#d7b17d', preset)
      } else if (preset === 'draw-ramp') {
        addBuildObject('ramp', 'Ramp', 180, 80, '#aeb8c2', preset)
      } else {
        chooseBuildTool('stairs', `${label} selected`, preset)
      }
      return
    }
    if (submenu === 'railing') {
      addBuildObject(
        preset.includes('deck') ? 'deck' : 'railing',
        label.replace('...', ''),
        preset === 'polygon-deck' ? 220 : 180,
        preset === 'polygon-deck' ? 150 : 24,
        preset.includes('deck') ? '#b98755' : '#7b8794',
        preset,
      )
      return
    }
    if (submenu === 'slab') {
      addBuildObject(
        preset.includes('pier') ? 'pier' : preset.includes('pad') ? 'pad' : 'slab',
        label,
        preset === 'round-pier' ? 45 : preset === 'square-pad' ? 60 : 220,
        preset === 'round-pier' ? 45 : preset === 'square-pad' ? 60 : 160,
        '#b8c0c8',
        preset,
      )
      return
    }
    if (submenu === 'floor') {
      if (preset === 'delete-current-floor') {
        removeBuildObjects(object => object.type === 'floor-area', 'Floor areas')
      } else if (preset === 'delete-foundation') {
        removeBuildObjects(object => object.build_variant === 'build-foundation', 'Foundation')
      } else if (preset === 'rebuild-shell') {
        walls.forEach(wall => updateWall(wall.id, { height: wall.height || 2.8 }))
        toast.success('Walls, floors, and ceilings rebuilt')
      } else if (preset.startsWith('exchange-floor')) {
        objects.filter(object => object.type === 'floor-area').forEach(object =>
          updateObject(object.id, { rotation: (object.rotation + 180) % 360 })
        )
        toast.success(label)
      } else {
        addBuildObject(
          preset === 'build-foundation' ? 'foundation' : 'floor-area',
          label.replace('...', ''),
          240,
          180,
          preset === 'build-foundation' ? '#9aa3ac' : '#d6b47a',
          preset,
        )
      }
      setShowBuildMenu(false)
      return
    }
    if (submenu === 'roof') {
      if (preset === 'delete-roof-planes') {
        removeBuildObjects(object => object.type === 'roof' || Boolean(object.build_variant?.includes('roof')), 'Roof planes')
      } else if (preset === 'delete-ceiling-planes') {
        removeBuildObjects(object => object.build_variant === 'ceiling-plane', 'Ceiling planes')
      } else if (preset === 'fix-roofs') {
        objects.filter(object => object.type === 'roof').forEach(object =>
          updateObject(object.id, { rotation: Math.round(object.rotation / 15) * 15 })
        )
        toast.success('Roof planes aligned')
      } else if (preset === 'skylight') {
        chooseBuildTool('window', 'Skylight selected', 'skylight')
      } else {
        addBuildObject(
          preset === 'ceiling-plane' ? 'ceiling' : preset === 'roof-hole' ? 'roof-hole' : 'roof',
          label.replace('...', ''),
          preset.includes('dormer') ? 100 : 220,
          preset.includes('dormer') ? 80 : 160,
          preset === 'ceiling-plane' ? '#eee8dc' : '#9f4f3f',
          preset,
        )
      }
    }
  }

  const importReferenceImage = () => {
    setShowBuildMenu(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const object = addObject({
        type: 'image',
        label: file.name,
        x: 300,
        y: 220,
        width: 180,
        height: 120,
        rotation: 0,
        color: '#dbeafe',
      })
      setSelected(object.id)
      setTool('select')
      toast.success('Reference image placeholder added')
    }
    input.click()
  }

  return (
    <>
      <header className="bg-panel border-b border-border px-4 py-2 flex items-center justify-between z-20 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-sm">
          <button
            className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
            onClick={() => navigate('/')}
          >
            <Home size={14} /> Dashboard
          </button>
          <div className="relative" ref={fileMenuRef}>
            <button
              className={`flex items-center gap-1 text-gray-400 hover:text-white transition-colors px-1.5 py-1 rounded-md ${showFileMenu ? 'bg-white/10 text-white' : ''}`}
              onClick={() => {
                setShowEditMenu(false)
                setShowBuildMenu(false)
                setShowFileMenu((value) => !value)
              }}
              title="File"
            >
              <FileText size={14} /> File
            </button>
            {showFileMenu && (
              <div className="absolute left-0 top-full mt-2 w-80 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-lg border border-border bg-panel shadow-2xl z-50 py-1.5">
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={createNewProject}
                  disabled={creatingProject}
                >
                  <FilePlus2 size={15} />
                  <span className="flex-1 text-left">{creatingProject ? 'Creating...' : 'New Project...'}</span>
                  <span className="text-[10px] text-gray-500">Ctrl+N</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={() => unavailable('New Project From Legacy Folder')}
                >
                  <FolderOpen size={15} />
                  <span className="flex-1 text-left">New Project From Legacy Folder...</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={makeProjectCopy}
                >
                  <Copy size={15} />
                  <span className="flex-1 text-left">Make a Copy of an Existing Project...</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={importPlanFile}
                >
                  <FolderOpen size={15} />
                  <span className="flex-1 text-left">Open Plan/Layout...</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={() => navigate('/')}
                >
                  <FileText size={15} />
                  <span className="flex-1 text-left">Open Recent Documents</span>
                  <ChevronRight size={13} />
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={() => navigate('/')}
                >
                  <LayoutDashboard size={15} />
                  <span className="flex-1 text-left">Dashboard...</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={() => unavailable('Download Sample Plans')}
                >
                  <Download size={15} />
                  <span className="flex-1 text-left">Download Sample Plans...</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={closeCurrentView}
                >
                  <X size={15} />
                  <span className="flex-1 text-left">Close View</span>
                  <span className="text-[10px] text-gray-500">Ctrl+W</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={closeAll3DViews}
                >
                  <X size={15} />
                  <span className="flex-1 text-left">Close All 3D Views</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={() => navigate('/')}
                >
                  <X size={15} />
                  <span className="flex-1 text-left">Close All Views</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={saveFromMenu}
                  disabled={saving || !isDirty}
                >
                  {saving ? <Save size={15} className="animate-pulse" /> : <Save size={15} />}
                  <span className="flex-1 text-left">{saving ? 'Saving...' : 'Save'}</span>
                  <span className="text-[10px] text-gray-500">Ctrl+S</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={openSaveAs}
                  disabled={saving || savingAs}
                >
                  <Copy size={15} />
                  <span className="flex-1 text-left">Make a Copy...</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={saveFromMenu}
                  disabled={saving}
                >
                  <Save size={15} />
                  <span className="flex-1 text-left">Save Entire Project</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={() => unavailable('Save As Template')}
                >
                  <FileText size={15} />
                  <span className="flex-1 text-left">Save As Template...</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={saveThumbnailImage}
                >
                  <ImageDown size={15} />
                  <span className="flex-1 text-left">Save Thumbnail Image</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={() => navigate('/')}
                >
                  <LayoutDashboard size={15} />
                  <span className="flex-1 text-left">Show in Project Browser</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={() => unavailable('Manage Auto Archives')}
                >
                  <Archive size={15} />
                  <span className="flex-1 text-left">Manage Auto Archives...</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={openSaveAs}
                >
                  <Download size={15} />
                  <span className="flex-1 text-left">Export</span>
                  <ChevronRight size={13} />
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={importPlanFile}
                >
                  <Upload size={15} />
                  <span className="flex-1 text-left">Import</span>
                  <ChevronRight size={13} />
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={exportPlanFile}
                >
                  <Archive size={15} />
                  <span className="flex-1 text-left">Back Up and Restore</span>
                  <ChevronRight size={13} />
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={printPlan}
                  disabled={savingAs}
                >
                  <Printer size={15} />
                  <span className="flex-1 text-left">Print</span>
                  <ChevronRight size={13} />
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => unavailable('Send to Layout')}
                >
                  <FileText size={15} />
                  <span className="flex-1 text-left">Send to Layout...</span>
                  <span className="text-[10px] text-gray-500">Ctrl+U</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                  onClick={() => navigate('/')}
                >
                  <LogOut size={15} />
                  <span className="flex-1 text-left">Exit</span>
                  <span className="text-[10px] text-gray-500">Alt+F4</span>
                </button>
              </div>
            )}
          </div>
          <div className="relative" ref={editMenuRef}>
            <button
              className={`flex items-center gap-1 text-gray-400 hover:text-white transition-colors px-1.5 py-1 rounded-md ${showEditMenu ? 'bg-white/10 text-white' : ''}`}
              onClick={() => {
                setShowFileMenu(false)
                setShowBuildMenu(false)
                setShowEditMenu(value => !value)
              }}
              title="Edit"
            >
              Edit
            </button>
            {showEditMenu && (
              <div className="absolute left-0 top-full mt-2 w-80 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-lg border border-border bg-panel shadow-2xl z-50 py-1.5">
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { undo(); setShowEditMenu(false) }}>
                  <Undo2 size={15} /><span className="flex-1 text-left">Undo</span><span className="text-[10px] text-gray-500">Ctrl+Z</span>
                </button>
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { redo(); setShowEditMenu(false) }}>
                  <Redo2 size={15} /><span className="flex-1 text-left">Redo</span><span className="text-[10px] text-gray-500">Ctrl+Y</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { cutSelection(); setShowEditMenu(false) }}>
                  <Scissors size={15} /><span className="flex-1 text-left">Cut</span><span className="text-[10px] text-gray-500">Ctrl+X</span>
                </button>
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { copySelection(); setShowEditMenu(false) }}>
                  <Copy size={15} /><span className="flex-1 text-left">Copy</span><span className="text-[10px] text-gray-500">Ctrl+C</span>
                </button>
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { pasteSelection(true); setShowEditMenu(false) }}>
                  <ClipboardPaste size={15} /><span className="flex-1 text-left">Copy and Paste in Place</span>
                </button>
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { pasteSelection(); setShowEditMenu(false) }}>
                  <ClipboardPaste size={15} /><span className="flex-1 text-left">Paste</span><ChevronRight size={13} />
                </button>
                <div className="my-1 h-px bg-border" />
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { deleteSelection(); setShowEditMenu(false) }}>
                  <Trash2 size={15} /><span className="flex-1 text-left">Delete</span><span className="text-[10px] text-gray-500">Del</span>
                </button>
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { deleteSelection(); setShowEditMenu(false) }}>
                  <Trash2 size={15} /><span className="flex-1 text-left">Delete Objects</span><span className="text-[10px] text-gray-500">Ctrl+Space</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { setTool('select'); setShowEditMenu(false) }}>
                  <MousePointer2 size={15} /><span className="flex-1 text-left">Select Objects</span><span className="text-[10px] text-gray-500">Space</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { cycleSnapGrid(); setShowEditMenu(false) }}>
                  <Magnet size={15} /><span className="flex-1 text-left">Snap Settings ({grid_size}px)</span><ChevronRight size={13} />
                </button>
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { setTool('select'); setShowEditMenu(false); toast.success('Direct edit behavior enabled') }}>
                  <Settings size={15} /><span className="flex-1 text-left">Edit Behaviors</span><ChevronRight size={13} />
                </button>
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { setTool('wall'); setShowEditMenu(false); toast.success('Arc creation starts from the wall tool') }}>
                  <Settings size={15} /><span className="flex-1 text-left">Arc Creation Modes</span><ChevronRight size={13} />
                </button>
                <div className="my-1 h-px bg-border" />
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { setTool('select'); setShowEditMenu(false) }}>
                  <MousePointer2 size={15} /><span className="flex-1 text-left">Edit Area</span><ChevronRight size={13} />
                </button>
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={() => { setTool('select'); setShowEditMenu(false); toast('Select a wall endpoint and drag to stretch it') }}>
                  <Ruler size={15} /><span className="flex-1 text-left">Stretch CAD</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={findReplaceText}>
                  <Search size={15} /><span className="flex-1 text-left">Find/Replace Text...</span><span className="text-[10px] text-gray-500">Ctrl+F</span>
                </button>
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={replaceFonts}>
                  <FileText size={15} /><span className="flex-1 text-left">Replace Fonts...</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={openPreferences}>
                  <Settings size={15} /><span className="flex-1 text-left">Default Settings...</span>
                </button>
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={resetEditorDefaults}>
                  <Settings size={15} /><span className="flex-1 text-left">Reset to Defaults...</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white" onClick={openPreferences}>
                  <Settings size={15} /><span className="flex-1 text-left">Preferences...</span><span className="text-[10px] text-gray-500">~</span>
                </button>
              </div>
            )}
          </div>
          <div className="relative" ref={buildMenuRef}>
            <button
              className={`flex items-center gap-1 text-gray-400 hover:text-white transition-colors px-1.5 py-1 rounded-md ${showBuildMenu ? 'bg-white/10 text-white' : ''}`}
              onClick={() => {
                setShowFileMenu(false)
                setShowEditMenu(false)
                setShowBuildMenu(value => {
                  if (value) setBuildSubmenu(null)
                  return !value
                })
              }}
              title="Build"
            >
              Build
            </button>
            {showBuildMenu && (
              <div
                className="absolute left-0 top-full mt-2 w-72 rounded-lg border border-border bg-panel shadow-2xl z-50 py-1.5"
                onMouseEnter={cancelBuildSubmenuClose}
                onMouseLeave={scheduleBuildSubmenuClose}
              >
                {([
                  ['wall', <BrickWall size={16} />],
                  ['railing', <PanelTop size={16} />],
                  ['fencing', <Fence size={16} />],
                  ['door', <DoorOpen size={16} />],
                  ['window', <Square size={16} />],
                  ['floor', <Layers3 size={16} />],
                  ['roof', <Home size={16} />],
                  ['slab', <PanelTop size={16} />],
                  ['stairs', <Rows4 size={16} />],
                ] as Array<[BuildSubmenu, React.ReactNode]>).map(([submenu, icon]) => (
                  <button
                    key={submenu}
                    className={`group/build-row w-full min-h-9 px-3 py-2 grid grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/35 hover:text-white ${buildSubmenu === submenu ? 'bg-black/45 text-white shadow-inner' : ''}`}
                    onMouseEnter={() => openBuildSubmenu(submenu)}
                    onFocus={() => openBuildSubmenu(submenu)}
                    onClick={() => openBuildSubmenu(submenu)}
                  >
                    <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
                    <span className="truncate text-left">{BUILD_SUBMENU_LABELS[submenu]}</span>
                    <ChevronRight
                      size={15}
                      className={`justify-self-end transition-transform ${buildSubmenu === submenu ? 'translate-x-0.5 text-primary-300' : 'text-gray-500 group-hover/build-row:text-gray-200'}`}
                    />
                  </button>
                ))}
                <button className="group/build-row w-full min-h-9 px-3 py-2 grid grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/35 hover:text-white" onMouseEnter={scheduleBuildSubmenuClose} onClick={() => addBuildObject('framing', 'Framing', 180, 80, '#c78b52', 'framing')}>
                  <span className="flex h-5 w-5 items-center justify-center"><Frame size={16} /></span><span className="truncate text-left">Framing</span><ChevronRight size={15} className="justify-self-end text-gray-500 group-hover/build-row:text-gray-200" />
                </button>
                <button className="group/build-row w-full min-h-9 px-3 py-2 grid grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/35 hover:text-white" onMouseEnter={scheduleBuildSubmenuClose} onClick={() => addBuildObject('trim', 'Trim', 180, 18, '#ead9b8', 'trim')}>
                  <span className="flex h-5 w-5 items-center justify-center"><PanelTop size={16} /></span><span className="truncate text-left">Trim</span><ChevronRight size={15} className="justify-self-end text-gray-500 group-hover/build-row:text-gray-200" />
                </button>
                <button className="group/build-row w-full min-h-9 px-3 py-2 grid grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/35 hover:text-white" onMouseEnter={scheduleBuildSubmenuClose} onClick={() => addBuildObject('cabinet', 'Cabinet', 100, 55, '#9a7048', 'cabinet')}>
                  <span className="flex h-5 w-5 items-center justify-center"><Warehouse size={16} /></span><span className="truncate text-left">Cabinet</span><ChevronRight size={15} className="justify-self-end text-gray-500 group-hover/build-row:text-gray-200" />
                </button>
                <button className="group/build-row w-full min-h-9 px-3 py-2 grid grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/35 hover:text-white" onMouseEnter={scheduleBuildSubmenuClose} onClick={() => addBuildObject('electrical', 'Electrical Fixture', 30, 30, '#f5c542', 'electrical')}>
                  <span className="flex h-5 w-5 items-center justify-center"><Zap size={16} /></span><span className="truncate text-left">Electrical</span><ChevronRight size={15} className="justify-self-end text-gray-500 group-hover/build-row:text-gray-200" />
                </button>
                <button className="group/build-row w-full min-h-9 px-3 py-2 grid grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/35 hover:text-white" onMouseEnter={scheduleBuildSubmenuClose} onClick={importReferenceImage}>
                  <span className="flex h-5 w-5 items-center justify-center"><ImagePlus size={16} /></span><span className="truncate text-left">Image</span><ChevronRight size={15} className="justify-self-end text-gray-500 group-hover/build-row:text-gray-200" />
                </button>

                {buildSubmenu && (
                  <div
                    className="absolute left-[calc(100%-2px)] w-80 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-lg border border-border bg-panel shadow-2xl py-1.5"
                    style={{
                      top: `${6 + ([
                        'wall',
                        'railing',
                        'fencing',
                        'door',
                        'window',
                        'floor',
                        'roof',
                        'slab',
                        'stairs',
                      ] as BuildSubmenu[]).indexOf(buildSubmenu) * 36}px`,
                    }}
                    onMouseEnter={cancelBuildSubmenuClose}
                    onMouseLeave={scheduleBuildSubmenuClose}
                  >
                    {BUILD_SUBMENU_ITEMS[buildSubmenu].map(item => (
                      <button
                        key={item.preset}
                        className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 transition-colors duration-150 hover:bg-black/40 hover:text-white focus:bg-black/40 focus:text-white"
                        onClick={() => runBuildCommand(buildSubmenu, item.preset, item.label)}
                      >
                        <span className="h-4 w-4 rounded-sm border border-current/40" />
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.shortcut && <span className="text-[10px] text-gray-500">{item.shortcut}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <ChevronRight size={12} className="text-gray-600" />
          <span className="text-white font-medium">{projectName}</span>
          {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-1" title="Unsaved changes" />}
        </div>

        <div className="flex bg-surface rounded-lg p-0.5 border border-border">
          {(['2d', 'split', '3d'] as const).map((v) => (
            <button
              key={v}
              className={`px-3 py-1 text-xs rounded-md transition-all ${
                view === v ? 'bg-primary-500 text-white' : 'text-gray-400 hover:text-white'
              }`}
              onClick={() => onViewChange(v)}
            >
              {v === '2d' ? '2D Plan' : v === '3d' ? '3D View' : 'Split'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost flex items-center gap-1.5 text-xs py-1.5"
            onClick={toggleMeasurementUnit}
            title="Switch wall length unit"
          >
            <Ruler size={13} />
            {unitLabel}
          </button>
          <button
            className="btn btn-ghost flex items-center gap-1.5 text-xs py-1.5"
            onClick={toggleWallMeasurementMode}
            title="Switch wall measurement display"
          >
            <ScanLine size={13} />
            {measurementModeLabel}
          </button>
          <button
            className="btn btn-ghost flex items-center gap-1.5 text-xs py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={record3DVideo}
            disabled={recording3D}
            title="Record 3D video"
          >
            <Video size={13} className={recording3D ? 'animate-pulse' : undefined} />
            {recording3D ? 'Recording...' : '3D video'}
          </button>
          <span className="text-xs text-gray-500">{isDirty ? 'Unsaved' : 'Saved'}</span>
          <button
            className="btn btn-ghost flex items-center gap-1.5 text-xs py-1.5 !text-black hover:!text-black disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={openSaveAs}
            disabled={saving || savingAs}
          >
            <Download size={13} />
            Save as
          </button>
          <button
            className="btn btn-primary flex items-center gap-1.5 text-xs py-1.5 !text-black hover:!text-black disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={save}
            disabled={saving || !isDirty}
          >
            {saving ? <Save size={13} className="animate-pulse" /> : isDirty ? <Save size={13} /> : <Check size={13} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </header>

      {showSaveAs && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => !savingAs && setShowSaveAs(false)}>
          <form className="bg-panel border border-border rounded-lg p-5 w-96 max-w-[calc(100vw-2rem)]" onSubmit={saveAs} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Save as</h2>
            <label className="block text-xs text-gray-400 mb-1">File name</label>
            <input
              className="w-full bg-white border border-border rounded-md px-3 py-2 !text-black outline-none focus:border-primary-500"
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              autoFocus
            />
            <label className="block text-xs text-gray-400 mt-4 mb-1">File type</label>
            <select
              className="w-full bg-white border border-border rounded-md px-3 py-2 !text-black outline-none focus:border-primary-500"
              value={saveAsFormat}
              onChange={(e) => setSaveAsFormat(e.target.value as SaveAsFormat)}
            >
              <option value="pdf">PDF (.pdf)</option>
              <option value="word">Word (.doc)</option>
              <option value="image">Image (.jpg)</option>
            </select>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                className="btn btn-ghost !text-black hover:!text-black"
                onClick={() => setShowSaveAs(false)}
                disabled={savingAs}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary flex items-center gap-1.5 !text-black hover:!text-black disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={savingAs || !saveAsName.trim()}
              >
                {savingAs ? <Save size={14} className="animate-pulse" /> : <Download size={14} />}
                {savingAs ? 'Saving...' : 'Save as'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
