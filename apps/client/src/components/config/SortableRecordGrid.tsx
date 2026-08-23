import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { AriaAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'

export interface SortableRecordGridItem {
  disabled?: boolean
  id: string
}

export interface SortableRecordGridRenderProps {
  dragHandleProps:
    & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onKeyDown' | 'onPointerDown'>
    & Pick<AriaAttributes, 'aria-describedby' | 'aria-disabled' | 'aria-pressed' | 'aria-roledescription'>
    & {
      role?: string
      tabIndex?: number
      ref: (element: HTMLElement | null) => void
    }
  isDragging: boolean
  ref: (element: HTMLDivElement | null) => void
  style: CSSProperties
}

interface SortableRecordGridItemProps {
  children: (props: SortableRecordGridRenderProps) => ReactNode
  disabled?: boolean
  id: string
}

const SortableRecordGridItem = ({ children, disabled, id }: SortableRecordGridItemProps) => {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform
  } = useSortable({ disabled, id })

  return children({
    dragHandleProps: {
      ...attributes,
      ...listeners,
      ref: setActivatorNodeRef
    } as SortableRecordGridRenderProps['dragHandleProps'],
    isDragging,
    ref: setNodeRef,
    style: {
      transform: CSS.Transform.toString(transform)
    }
  })
}

export const SortableRecordGrid = ({
  children,
  items,
  onReorder
}: {
  children: (item: SortableRecordGridItem, props: SortableRecordGridRenderProps) => ReactNode
  items: SortableRecordGridItem[]
  onReorder: (activeId: string, overId: string) => void
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  return (
    <DndContext
      collisionDetection={closestCenter}
      sensors={sensors}
      onDragEnd={({ active, over }) => {
        if (over == null || active.id === over.id) return
        onReorder(String(active.id), String(over.id))
      }}
    >
      <SortableContext items={items} strategy={rectSortingStrategy}>
        {items.map(item => (
          <SortableRecordGridItem key={item.id} disabled={item.disabled} id={item.id}>
            {props => children(item, props)}
          </SortableRecordGridItem>
        ))}
      </SortableContext>
    </DndContext>
  )
}
