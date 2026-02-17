import { useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { S3Object, TransformInfo } from "../api/queries";

function fileName(key: string, prefix: string): string {
  return key.slice(prefix.length);
}

function isImage(key: string): boolean {
  return /\.(jpe?g|png|gif|webp|avif|tiff?)$/i.test(key);
}

function thumbUrl(siteUrl: string, transforms: TransformInfo[], key: string): string | null {
  if (!siteUrl || !isImage(key)) return null;
  const t = transforms.find((t) => t.key === "thumb")
    ?? transforms.find((t) => t.key === "thumb-sq")
    ?? transforms[0];
  if (!t) return null;
  let url = `${siteUrl}/${t.key}/${key}`;
  if (t.format) {
    const lastDot = url.lastIndexOf(".");
    if (lastDot !== -1) url = `${url.substring(0, lastDot)}.${t.format}`;
  }
  return url;
}

const FileIcon = () => (
  <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
  </svg>
);

function SortableItem({
  obj,
  prefix,
  siteUrl,
  transforms,
}: {
  obj: S3Object;
  prefix: string;
  siteUrl: string;
  transforms: TransformInfo[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: obj.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const thumb = thumbUrl(siteUrl, transforms, obj.key);
  const name = fileName(obj.key, prefix);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="relative cursor-grab active:cursor-grabbing">
      <div
        className="block w-full overflow-hidden rounded-lg bg-slate-100 ring-2 ring-accent-400/60 ring-offset-2 shadow-sm"
        style={{ aspectRatio: "1" }}
      >
        {thumb ? (
          <img src={thumb} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2">
            <FileIcon />
            <span className="text-[10px] text-slate-400 truncate w-full text-center">{name}</span>
          </div>
        )}
      </div>
      <p className="mt-1 truncate px-0.5 text-[11px] text-slate-500" title={name}>
        {name}
      </p>
    </div>
  );
}

interface SortableGridViewProps {
  objects: S3Object[];
  prefix: string;
  siteUrl: string;
  transforms: TransformInfo[];
  onOrderChange: (order: string[]) => void;
}

export function SortableGridView({
  objects,
  prefix,
  siteUrl,
  transforms,
  onOrderChange,
}: SortableGridViewProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = objects.findIndex((o) => o.key === active.id);
      const newIndex = objects.findIndex((o) => o.key === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(objects, oldIndex, newIndex);
      onOrderChange(reordered.map((o) => fileName(o.key, prefix)));
    },
    [objects, prefix, onOrderChange],
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={objects.map((o) => o.key)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-3 gap-2 p-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {objects.map((obj) => (
            <SortableItem
              key={obj.key}
              obj={obj}
              prefix={prefix}
              siteUrl={siteUrl}
              transforms={transforms}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
