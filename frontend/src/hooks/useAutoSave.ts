import { useEffect, useRef } from 'react'
import { useFloorPlanStore } from '../store/useFloorPlanStore'
import { api } from '../api/client'
import toast from 'react-hot-toast'
import { captureAndStoreProjectThumbnail } from '../utils/projectThumbnails'

export function useAutoSave(projectId: string | undefined) {
  const { isDirty, getFloorPlan, markClean } = useFloorPlanStore()
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const savingRef = useRef(false)

  useEffect(() => {
    if (!projectId || !isDirty || savingRef.current) return

    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      if (!isDirty) return
      savingRef.current = true
      try {
        await api.put(`/projects/${projectId}/floorplan`, getFloorPlan())
        await captureAndStoreProjectThumbnail(projectId)
        markClean()
      } catch {
        toast.error('Auto-save failed')
      } finally {
        savingRef.current = false
      }
    }, 1500)

    return () => clearTimeout(timerRef.current)
  }, [isDirty, projectId])
}
