import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api/client'
import { useFloorPlanStore } from '../store/useFloorPlanStore'
import { useAutoSave } from '../hooks/useAutoSave'
import type { Project } from '../types/schema'

import Canvas2D from '../components/editor/Canvas2D'
import Viewer3D from '../components/viewer3d/Viewer3D'
import Toolbar from '../components/layout/Toolbar'
import EditorHeader from '../components/layout/EditorHeader'
import StatusBar from '../components/layout/StatusBar'
import PropertiesPanel from '../components/layout/PropertiesPanel'

import toast from 'react-hot-toast'

type ViewMode = '2d' | '3d' | 'split'

function SizedCanvas({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className={className} style={style}>
      <Canvas2D stageWidth={size.w} stageHeight={size.h} />
    </div>
  )
}

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const hydrate = useFloorPlanStore((s) => s.hydrate)

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>('split')
  const [showProperties, setShowProperties] = useState(true)

  useAutoSave(projectId)

  useEffect(() => {
    if (!projectId) return
    api.get(`/projects/${projectId}`)
      .then(({ data }) => {
        setProject(data)
        hydrate(data.floor_plan)
      })
      .catch(() => {
        toast.error('Project not found')
        navigate('/')
      })
      .finally(() => setLoading(false))
  }, [projectId])

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">🏠</div>
          <p>Loading project...</p>
        </div>
      </div>
    )
  }

  if (!project) return null

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden">
      <EditorHeader
        projectId={project.id}
        projectName={project.name}
        view={view}
        onViewChange={setView}
      />

      <div className="flex flex-1 overflow-hidden">
        <Toolbar />

        <div className="flex flex-1 overflow-hidden relative">
          <div className="editor-panel-toggles">
            <button
              className={`editor-panel-toggle ${showProperties ? 'active' : ''}`}
              onClick={() => setShowProperties((value) => !value)}
              title={showProperties ? 'Hide properties' : 'Show properties'}
              aria-pressed={showProperties}
            >
              {showProperties ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>

          {view === '2d' && (
            <SizedCanvas className="flex-1 overflow-hidden bg-gray-200" />
          )}


          {view === 'split' && (
            <>
              <div className="relative overflow-hidden" style={{ width: '50%' }}>
                <SizedCanvas className="w-full h-full bg-gray-200" />
                <div className="absolute top-2 left-2 text-xs text-gray-600 bg-surface/80 px-2 py-0.5 rounded pointer-events-none">
                  2D Plan
                </div>
              </div>
              <div className="w-px bg-border flex-shrink-0" />
              <div className="relative overflow-hidden" style={{ width: '50%' }}>
                <Viewer3D />
                <div className="absolute top-2 left-2 text-xs text-gray-600 bg-surface/80 px-2 py-0.5 rounded pointer-events-none">
                  3D View
                </div>
                <div className="absolute bottom-2 left-2 text-xs text-gray-600 pointer-events-none">
                  Drag to orbit · Scroll to zoom
                </div>
              </div>
            </>
          )}

          {view === '3d' && (
            <div className="flex-1 relative overflow-hidden">
              <Viewer3D />
              <div className="absolute top-2 left-2 text-xs text-gray-600 bg-surface/80 px-2 py-0.5 rounded pointer-events-none">
                3D View
              </div>
              <div className="absolute bottom-2 left-2 text-xs text-gray-600 pointer-events-none">
                Drag to orbit · Scroll to zoom · Right-drag to pan
              </div>
            </div>
          )}
        </div>

        {showProperties && (
          <div className="flex">
            <PropertiesPanel />
          </div>
        )}
      </div>

      <StatusBar />
    </div>
  )
}
