import { useFloorPlanStore } from '../../store/useFloorPlanStore'

export default function StatusBar() {
  const { walls, objects, activeTool, isDirty } = useFloorPlanStore()

  const hints: Record<string, string> = {
    select: 'Click to select - Drag to move - Right-drag or Alt-drag to pan - Scroll to zoom',
    wall: 'Click to start wall - Click to place endpoint - Double-click to finish - Hold Shift for straight walls',
    pan: 'Click and drag to pan the canvas - Right-drag also pans - Scroll to zoom',
    door: 'Select tool then click a wall to add a door',
    doubleDoor: 'Select tool then click a wall to add a double door',
    stairs: 'Click to start stairs - Click to place endpoint - Hold Shift for straight stairs',
    gate: 'Select tool then click a wall to add a gate',
    window: 'Select tool then click a wall to add a window',
    object: 'Open Furniture from the left sidebar to add objects',
    text: 'Click the plan to place text - Double-click placed text or edit Label in Properties',
    delete: 'Click any element to delete it',
  }

  return (
    <div className="bg-panel border-t border-border px-4 py-1 flex items-center justify-between text-xs text-gray-500 flex-shrink-0">
      <span>{hints[activeTool] || ''}</span>
      <div className="flex items-center gap-4">
        <span>{walls.length} walls</span>
        <span>{objects.length} objects</span>
        <span className={isDirty ? 'text-amber-400' : 'text-green-500'}>
          {isDirty ? 'Unsaved' : 'Saved'}
        </span>
      </div>
    </div>
  )
}
