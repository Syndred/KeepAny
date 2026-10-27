import type { ComponentType } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';

export type SortableNavItem = {
  id: string;
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  badge?: number;
  active?: boolean;
  visible?: boolean;
  visibilityLocked?: boolean;
  visibilityLockReason?: string;
};

export type SortableNavProps = {
  items: SortableNavItem[];
  activePath: string;
  onOrderChange: (ids: string[]) => void;
  onVisibilityChange?: (id: string, visible: boolean) => void;
  onNavigate: () => void;
  manageMode?: boolean;
};

function NavRow({ item, index, count, activePath, onNavigate, onMove, onVisibilityChange, manageMode }: {
  item: SortableNavItem;
  index: number;
  count: number;
  activePath: string;
  onNavigate: () => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onVisibilityChange?: (id: string, visible: boolean) => void;
  manageMode: boolean;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const active = item.active ?? (item.to === '/' ? activePath === '/' : activePath === item.to || activePath.startsWith(`${item.to}/`));
  const Icon = item.icon;
  const visible = item.visible !== false;

  return <div
    ref={setNodeRef}
    className={`sortable-nav-item${isDragging ? ' is-dragging' : ''}${manageMode ? ' is-managing' : ''}${visible ? '' : ' is-hidden'}`}
    style={{ transform: CSS.Transform.toString(transform), transition }}
  >
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="nav-drag-handle"
      {...attributes}
      {...listeners}
      aria-label={`${item.label} ${t('drag')}`}
      title={t('drag')}
    ><GripVertical size={17}/></button>
    {visible ? <Link to={item.to} activeOptions={{ exact: true }} className={`sortable-nav-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onNavigate} title={item.label}>
      <Icon size={17}/><span className="nav-label">{item.label}</span>{item.badge != null && item.badge > 0 && <Badge className="nav-count" tone="neutral">{item.badge}</Badge>}
    </Link> : <span className="sortable-nav-link nav-link-placeholder"><Icon size={17}/><span>{item.label}</span></span>}
    {manageMode && <label className="nav-visibility-hitarea"><input
      type="checkbox"
      className="nav-visibility-toggle"
      checked={visible}
      disabled={item.visibilityLocked}
      onChange={(event) => onVisibilityChange?.(item.id, event.target.checked)}
      aria-label={`${t('showNavItem')}: ${item.label}`}
      title={item.visibilityLockReason ?? `${t(visible ? 'hideNavItem' : 'showNavItem')}: ${item.label}`}
    /></label>}
    {manageMode && <div className="nav-order-actions">
      <button type="button" onClick={() => onMove(item.id, -1)} disabled={index === 0} aria-label={`${t('navMoveUp')} ${item.label}`} title={t('navMoveUp')}><ChevronUp size={14}/></button>
      <button type="button" onClick={() => onMove(item.id, 1)} disabled={index === count - 1} aria-label={`${t('navMoveDown')} ${item.label}`} title={t('navMoveDown')}><ChevronDown size={14}/></button>
    </div>}
  </div>;
}

export function SortableNav({ items, activePath, onOrderChange, onVisibilityChange, onNavigate, manageMode = false }: SortableNavProps) {
  const { t } = useTranslation();
  const ids = items.map(item => item.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function move(id: string, direction: -1 | 1) {
    const from = ids.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    onOrderChange(arrayMove(ids, from, to));
  }

  function finishDrag(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    onOrderChange(arrayMove(ids, from, to));
  }

  return <DndContext
    sensors={sensors}
    collisionDetection={closestCenter}
    onDragEnd={finishDrag}
    accessibility={{
      screenReaderInstructions: { draggable: t('navDndInstructions') },
      announcements: {
        onDragStart: ({ active }) => t('navPickedUp', { name: items.find(item => item.id === active.id)?.label ?? '' }),
        onDragOver: ({ active, over }) => over ? t('navMoved', { name: items.find(item => item.id === active.id)?.label ?? '', position: ids.indexOf(String(over.id)) + 1 }) : undefined,
        onDragEnd: ({ active, over }) => over ? t('navDropped', { name: items.find(item => item.id === active.id)?.label ?? '', position: ids.indexOf(String(over.id)) + 1 }) : t('navCancelled'),
        onDragCancel: () => t('navCancelled'),
      },
    }}
  ><SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {items.map((item, index) => <NavRow key={item.id} item={item} index={index} count={items.length} activePath={activePath} onNavigate={onNavigate} onMove={move} onVisibilityChange={onVisibilityChange} manageMode={manageMode}/>)}
    </SortableContext></DndContext>;
}
