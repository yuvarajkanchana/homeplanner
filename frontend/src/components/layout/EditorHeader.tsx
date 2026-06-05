import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Home, Save, ChevronRight, Check, Ruler, ScanLine, Download, Video,
  FileText, FilePlus2, FolderOpen, Printer, ImageDown
} from 'lucide-react'
import { useFloorPlanStore } from '../../store/useFloorPlanStore'
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
  } = useFloorPlanStore()
  const [saving, setSaving] = useState(false)
  const [savingAs, setSavingAs] = useState(false)
  const [recording3D, setRecording3D] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [showFileMenu, setShowFileMenu] = useState(false)
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [saveAsName, setSaveAsName] = useState(`${projectName} Copy`)
  const [saveAsFormat, setSaveAsFormat] = useState<SaveAsFormat>('pdf')
  const fileMenuRef = useRef<HTMLDivElement | null>(null)
  const unitLabel = measurementUnit === 'm' ? 'Meters' : measurementUnit === 'ft' ? 'Feet' : `Feet/In`
  const measurementModeLabel = wallMeasurementMode === 'outer'
    ? 'Outer dims'
    : wallMeasurementMode === 'none'
      ? 'No dims'
      : 'All dims'

  useEffect(() => {
    if (!showFileMenu) return
    const closeMenu = (event: MouseEvent) => {
      if (fileMenuRef.current?.contains(event.target as Node)) return
      setShowFileMenu(false)
    }
    window.addEventListener('mousedown', closeMenu)
    return () => window.removeEventListener('mousedown', closeMenu)
  }, [showFileMenu])

  useEffect(() => {
    const handleFileShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()

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

      if (key === 'n' && !isTypingTarget(event.target)) {
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
              onClick={() => setShowFileMenu((value) => !value)}
              title="File"
            >
              <FileText size={14} /> File
            </button>
            {showFileMenu && (
              <div className="absolute left-0 top-full mt-2 w-56 rounded-lg border border-border bg-panel shadow-2xl z-50 py-1.5">
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={createNewProject}
                  disabled={creatingProject}
                >
                  <FilePlus2 size={15} />
                  <span className="flex-1 text-left">{creatingProject ? 'Creating...' : 'New project'}</span>
                  <span className="text-[10px] text-gray-500">Ctrl+N</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 hover:bg-white/10"
                  onClick={openFolder}
                >
                  <FolderOpen size={15} />
                  <span className="flex-1 text-left">Open folder</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={saveFromMenu}
                  disabled={saving || !isDirty}
                >
                  {saving ? <Save size={15} className="animate-pulse" /> : <Save size={15} />}
                  <span className="flex-1 text-left">{saving ? 'Saving...' : 'Save'}</span>
                  <span className="text-[10px] text-gray-500">Ctrl+S</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={openSaveAs}
                  disabled={saving || savingAs}
                >
                  <Download size={15} />
                  <span className="flex-1 text-left">Save as</span>
                  <span className="text-[10px] text-gray-500">Ctrl+Shift+S</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={saveAsImage}
                  disabled={savingAs}
                >
                  <ImageDown size={15} />
                  <span className="flex-1 text-left">Export image</span>
                </button>
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={printPlan}
                  disabled={savingAs}
                >
                  <Printer size={15} />
                  <span className="flex-1 text-left">Print</span>
                  <span className="text-[10px] text-gray-500">Ctrl+P</span>
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm text-gray-100 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    setShowFileMenu(false)
                    record3DVideo()
                  }}
                  disabled={recording3D}
                >
                  <Video size={15} className={recording3D ? 'animate-pulse' : undefined} />
                  <span className="flex-1 text-left">{recording3D ? 'Recording...' : 'Record 3D video'}</span>
                </button>
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
