import { Plus } from 'lucide-react'
import { useFloorPlanStore } from '../../store/useFloorPlanStore'

export default function FloorTabs() {
  const floors = useFloorPlanStore(state => state.floors)
  const activeFloorId = useFloorPlanStore(state => state.activeFloorId)
  const setActiveFloor = useFloorPlanStore(state => state.setActiveFloor)
  const addFloor = useFloorPlanStore(state => state.addFloor)

  return (
    <div className="flex h-10 flex-shrink-0 items-end gap-1 overflow-x-auto border-b border-border bg-panel px-3 pt-1">
      {floors
        .slice()
        .sort((a, b) => a.level - b.level)
        .map(floor => {
          const active = floor.id === activeFloorId
          return (
            <button
              key={floor.id}
              type="button"
              className={`h-9 whitespace-nowrap rounded-t-md border px-4 text-xs font-medium transition-colors ${
                active
                  ? 'border-border border-b-surface bg-surface text-white'
                  : 'border-transparent text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
              onClick={() => setActiveFloor(floor.id)}
              aria-pressed={active}
            >
              {floor.name}
            </button>
          )
        })}

      <button
        type="button"
        className="mb-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-border text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        onClick={addFloor}
        title="Add floor"
        aria-label="Add floor"
      >
        <Plus size={15} />
      </button>
    </div>
  )
}
