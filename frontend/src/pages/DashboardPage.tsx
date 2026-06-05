import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/useAuthStore'
import type { FloorPlan, Project, ProjectSummary } from '../types/schema'
import toast from 'react-hot-toast'
import { Plus, LogOut, Trash2, Edit3, Home, ChevronUp, ChevronDown } from 'lucide-react'
import dashboardBg from '../assets/dashboard-home-bg.png'
import { getProjectThumbnail, removeProjectThumbnail } from '../utils/projectThumbnails'

const escapeSvg = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function buildProjectPreviewSrc(project: ProjectSummary, floorPlan?: FloorPlan) {
  if (!floorPlan || floorPlan.walls.length === 0) {
    const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 360" role="img" aria-label="${escapeSvg(project.name)} preview"><rect width="720" height="360" fill="#fff"/><path d="M300 180 H420 M360 120 V240" stroke="#cbd5e1" stroke-width="5" stroke-linecap="round"/></svg>`
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(emptySvg)}`
  }

  const objectPoints = floorPlan.objects.flatMap((object) => {
    if (object.type === 'text') return []
    const halfW = object.width / 2
    const halfH = object.height / 2
    const angle = object.rotation * Math.PI / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return [
      { x: -halfW, y: -halfH },
      { x: halfW, y: -halfH },
      { x: halfW, y: halfH },
      { x: -halfW, y: halfH },
    ].map((point) => ({
      x: object.x + point.x * cos - point.y * sin,
      y: object.y + point.x * sin + point.y * cos,
    }))
  })
  const boundsPoints = [
    ...floorPlan.walls.flatMap((wall) => [wall.start, wall.end]),
    ...objectPoints,
  ]
  const minX = Math.min(...boundsPoints.map((point) => point.x))
  const maxX = Math.max(...boundsPoints.map((point) => point.x))
  const minY = Math.min(...boundsPoints.map((point) => point.y))
  const maxY = Math.max(...boundsPoints.map((point) => point.y))
  const previewW = 720
  const previewH = 720
  const padding = 8
  const planW = Math.max(1, maxX - minX)
  const planH = Math.max(1, maxY - minY)
  const scaleX = (previewW - padding * 2) / planW
  const scaleY = (previewH - padding * 2) / planH
  const scale = Math.min(scaleX, scaleY)
  const offsetX = (previewW - planW * scale) / 2
  const offsetY = (previewH - planH * scale) / 2

  const x = (value: number) => (value - minX) * scale + offsetX
  const y = (value: number) => (value - minY) * scale + offsetY
  const visibleObjects = floorPlan.objects.filter((object) => (
    object.type !== 'text'
  ))
  const openingPosition = (opening: FloorPlan['openings'][number]) => {
    const wall = floorPlan.walls.find((item) => item.id === opening.wall_id)
    if (!wall) return null
    return {
      x: x(wall.start.x + (wall.end.x - wall.start.x) * opening.offset),
      y: y(wall.start.y + (wall.end.y - wall.start.y) * opening.offset),
      angle: Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x),
      width: Math.max(6, opening.width * scale),
      type: opening.type,
    }
  }
  const wallStrokeWidth = (thickness: number) => Math.max(2, Math.min(4.25, thickness * scale))
  const openingCutWidth = Math.max(5, Math.min(7, 4.5 * scale))
  const detailStrokeWidth = Math.max(1, Math.min(1.6, scale))
  const wallLines = floorPlan.walls.map((wall) => (
    `<line x1="${x(wall.start.x)}" y1="${y(wall.start.y)}" x2="${x(wall.end.x)}" y2="${y(wall.end.y)}" stroke-width="${wallStrokeWidth(wall.thickness)}"/>`
  )).join('')
  const openingCuts = floorPlan.openings.map((opening) => {
    const position = openingPosition(opening)
    if (!position) return ''
    const dx = Math.cos(position.angle) * position.width / 2
    const dy = Math.sin(position.angle) * position.width / 2
    return `<line x1="${position.x - dx}" y1="${position.y - dy}" x2="${position.x + dx}" y2="${position.y + dy}" stroke-width="${openingCutWidth}"/>`
  }).join('')
  const openingDetails = floorPlan.openings.map((opening) => {
    const position = openingPosition(opening)
    if (!position) return ''
    const dx = Math.cos(position.angle) * position.width / 2
    const dy = Math.sin(position.angle) * position.width / 2
    if (position.type === 'window') {
      return `<line x1="${position.x - dx}" y1="${position.y - dy}" x2="${position.x + dx}" y2="${position.y + dy}"/>`
    }
    return `<path d="M ${position.x - dx} ${position.y - dy} Q ${position.x} ${position.y - position.width * 0.45} ${position.x + dx} ${position.y + dy}" opacity="0.7"/>`
  }).join('')
  const objectRects = visibleObjects.map((object) => (
    `<rect x="${x(object.x - object.width / 2)}" y="${y(object.y - object.height / 2)}" width="${Math.max(4, object.width * scale)}" height="${Math.max(4, object.height * scale)}" rx="2" transform="rotate(${object.rotation} ${x(object.x)} ${y(object.y)})"/>`
  )).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${previewW} ${previewH}" role="img" aria-label="${escapeSvg(project.name)} preview"><rect width="${previewW}" height="${previewH}" fill="#fff"/><g stroke="#374151" stroke-linecap="square">${wallLines}</g><g stroke="#fff" stroke-linecap="square">${openingCuts}</g><g stroke="#6b7280" stroke-width="${detailStrokeWidth}" fill="none">${openingDetails}</g><g stroke="#6b7280" stroke-width="${detailStrokeWidth}" fill="#fff">${objectRects}</g></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const { user, logout } = useAuthStore()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectPlans, setProjectPlans] = useState<Record<string, FloorPlan>>({})
  const [projectThumbnails, setProjectThumbnails] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  const load = async () => {
    try {
      const { data } = await api.get('/projects/')
      const loadedProjects = data as ProjectSummary[]
      setProjects(loadedProjects)
      setProjectThumbnails(
        loadedProjects.reduce<Record<string, string>>((thumbnails, project) => {
          const thumbnail = getProjectThumbnail(project.id)
          if (thumbnail) thumbnails[project.id] = thumbnail
          return thumbnails
        }, {})
      )
      const details = await Promise.allSettled(
        loadedProjects.map((project) => api.get(`/projects/${project.id}`))
      )
      const plans = details.reduce<Record<string, FloorPlan>>((nextPlans, result) => {
        if (result.status === 'fulfilled') {
          const project = result.value.data as Project
          nextPlans[project.id] = project.floor_plan
        }
        return nextPlans
      }, {})
      setProjectPlans(plans)
    } catch {
      toast.error('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const { data } = await api.post('/projects/', { name: newName, description: newDesc })
      navigate(`/editor/${data.id}`)
    } catch {
      toast.error('Failed to create project')
      setCreating(false)
    }
  }

  const deleteProject = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    try {
      await api.delete(`/projects/${id}`)
      setProjects((p) => p.filter((x) => x.id !== id))
      setProjectThumbnails((thumbnails) => {
        const next = { ...thumbnails }
        delete next[id]
        return next
      })
      removeProjectThumbnail(id)
      toast.success('Project deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const scrollProjects = (direction: 'up' | 'down') => {
    mainRef.current?.scrollBy({
      top: direction === 'up' ? -520 : 520,
      behavior: 'smooth',
    })
  }

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden bg-cover bg-center bg-fixed"
      style={{ backgroundImage: `url(${dashboardBg})` }}
    >
      <div className="absolute inset-0 bg-white/72 backdrop-blur-[1px]" />
      <header className="relative z-10 bg-white/92 backdrop-blur-md border-b border-white px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2 text-white font-semibold">
          <Home size={20} className="text-primary-500" />
          <span className="text-gray-950">HomePlanner</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-900 font-medium">Hi, {user?.username}</span>
          <button className="btn btn-ghost flex items-center gap-1.5 text-sm" onClick={() => { logout(); navigate('/login') }}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </header>

      <main ref={mainRef} className="dashboard-scroll relative z-10 min-h-0 w-full flex-1 overflow-y-auto px-6 py-8 pb-24">
        <div className="mx-auto w-full max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-black">My Projects</h1>
            <p className="text-black text-sm mt-0.5">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
          </div>
          <button className="btn btn-primary flex items-center gap-2" onClick={() => setShowNew(true)}>
            <Plus size={16} /> New Project
          </button>
        </div>

        {showNew && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowNew(false)}>
            <div className="bg-panel border border-border rounded-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-medium text-white mb-4">New Project</h2>
              <form onSubmit={createProject} className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Project name *</label>
                  <input autoFocus className="input-field" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My Living Room" required />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Description</label>
                  <input className="input-field" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Optional..." />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" className="btn btn-ghost flex-1" onClick={() => setShowNew(false)}>Cancel</button>
                  <button type="submit" disabled={creating} className="btn btn-primary flex-1">
                    {creating ? 'Creating...' : 'Create & Open'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-24 bg-white/90 backdrop-blur-md border border-white rounded-xl shadow-lg">
            <div className="text-gray-700 mb-4">
              <Home size={56} className="mx-auto" />
            </div>
            <p className="text-gray-400 text-lg">No projects yet</p>
            <p className="text-gray-600 text-sm mt-1 mb-5">Create your first floor plan to get started</p>
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>
              <Plus size={15} className="inline mr-1" /> New Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="group relative overflow-hidden rounded-2xl border border-white/80 bg-white/88 p-3 shadow-md backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-500/50 hover:bg-white/95 hover:shadow-lg cursor-default"
                onDoubleClick={() => navigate(`/editor/${p.id}`)}
                title="Double-click to open project"
              >
                <div className="mb-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-1 text-gray-600 shadow-inner">
                  <img
                    src={projectThumbnails[p.id] ?? buildProjectPreviewSrc(p, projectPlans[p.id])}
                    alt={`${p.name} preview`}
                    className="h-full w-full rounded-lg object-contain shadow-sm contrast-95 saturate-[0.9] transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                </div>
                <h3 className="text-gray-950 font-medium truncate">{p.name}</h3>
                {p.description && <p className="text-gray-600 text-xs truncate mt-0.5">{p.description}</p>}
                <div className="text-xs text-gray-700 mt-1">
                  {p.wall_count} walls - {p.object_count} objects
                </div>
                <div className="text-xs text-gray-600 mt-0.5">Updated {fmt(p.updated_at)}</div>
                <div className="mt-3 hidden gap-2 group-hover:flex">
                  <button
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white/80 px-3 py-2 text-xs font-medium text-gray-900 shadow-sm transition-colors hover:border-primary-500/50 hover:bg-primary-50"
                    onClick={() => navigate(`/editor/${p.id}`)}
                  >
                    <Edit3 size={13} /> Open
                  </button>
                  <button
                    className="flex h-9 w-10 items-center justify-center rounded-md border border-red-200 bg-white/80 text-red-600 shadow-sm transition-colors hover:bg-red-50 hover:border-red-300"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteProject(p.id, p.name)
                    }}
                    title="Delete project"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        </div>

        {!loading && projects.length >= 4 && (
          <div className="fixed bottom-6 right-6 z-30 flex flex-col gap-2">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/80 bg-white/90 text-gray-900 shadow-lg backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white"
              onClick={() => scrollProjects('up')}
              title="Scroll projects up"
              aria-label="Scroll projects up"
            >
              <ChevronUp size={18} />
            </button>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/80 bg-white/90 text-gray-900 shadow-lg backdrop-blur-md transition hover:translate-y-0.5 hover:bg-white"
              onClick={() => scrollProjects('down')}
              title="Scroll projects down"
              aria-label="Scroll projects down"
            >
              <ChevronDown size={18} />
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
