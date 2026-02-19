import { useState, useCallback } from "react";
import type { S3Object, TransformInfo } from "../api/queries";
import { SortableGridView } from "./sortable-grid";

export type ViewMode = "list" | "grid";


interface ObjectGridProps {
  folders: string[];
  objects: S3Object[];
  prefix: string;
  viewMode: ViewMode;
  siteUrl: string;
  transforms: TransformInfo[];
  dirConfigFile: string;
  onFolderClick: (folder: string) => void;
  onFileClick: (obj: S3Object) => void;
  onDeleteClick: (key: string) => void;
  onRotateClick?: (key: string, direction: "cw" | "ccw") => void;
  onDescribeClick?: (key: string) => void;
  /** Map of key → timestamp for cache-busting after rotation */
  cacheBusts?: Map<string, number>;
  onBulkDelete?: (keys: string[]) => void;
  isReordering?: boolean;
  onOrderChange?: (order: string[]) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileName(key: string, prefix: string): string {
  return key.slice(prefix.length);
}

function folderName(folder: string, prefix: string): string {
  const relative = folder.slice(prefix.length);
  return relative.endsWith("/") ? relative.slice(0, -1) : relative;
}

function isImage(key: string): boolean {
  return /\.(jpe?g|png|gif|webp|avif|tiff?)$/i.test(key);
}

function thumbUrl(siteUrl: string, transforms: TransformInfo[], key: string, cacheBust?: number): string | null {
  if (!siteUrl || !isImage(key)) return null;
  // Prefer thumb, then thumb-sq, then first available
  const t = transforms.find((t) => t.key === "thumb")
    ?? transforms.find((t) => t.key === "thumb-sq")
    ?? transforms[0];
  if (!t) return null;
  let url = `${siteUrl}/${t.key}/${key}`;
  if (t.format) {
    const lastDot = url.lastIndexOf(".");
    if (lastDot !== -1) url = `${url.substring(0, lastDot)}.${t.format}`;
  }
  if (cacheBust) url += `?v=${cacheBust}`;
  return url;
}

const FolderIcon = () => (
  <svg className="h-5 w-5 shrink-0 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
  </svg>
);

const FileIcon = () => (
  <svg className="h-5 w-5 shrink-0 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
  </svg>
);

/** Image that retries on error (handles transforms not ready yet). */
function RetryImg({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  const onError = useCallback(() => {
    if (attempt < 3) {
      setTimeout(() => setAttempt((a) => a + 1), 2000 * (attempt + 1));
    } else {
      setFailed(true);
    }
  }, [attempt]);

  if (failed) {
    return <div className={`${className} flex items-center justify-center bg-gray-100`}><FileIcon /></div>;
  }

  return (
    <img
      key={attempt}
      src={attempt > 0 ? `${src}?r=${attempt}` : src}
      alt={alt}
      className={className}
      onError={onError}
    />
  );
}

const DeleteButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className="shrink-0 rounded-md p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
    title="Delete"
  >
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  </button>
);

const RotateCCWButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className="shrink-0 rounded-md p-1 text-slate-300 transition hover:bg-blue-50 hover:text-blue-500"
    title="Rotate left"
  >
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M2.5 2v6h6M2.66 15.57a10 10 0 10.57-8.38" />
    </svg>
  </button>
);

const RotateCWButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className="shrink-0 rounded-md p-1 text-slate-300 transition hover:bg-blue-50 hover:text-blue-500"
    title="Rotate right"
  >
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ transform: "scaleX(-1)" }}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M2.5 2v6h6M2.66 15.57a10 10 0 10.57-8.38" />
    </svg>
  </button>
);

const AnalyzeButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className="shrink-0 rounded-md p-1 text-slate-300 transition hover:bg-purple-50 hover:text-purple-500"
    title="Analyze with AI"
  >
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  </button>
);

const Checkbox = ({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) => (
  <label className="flex items-center" onClick={(e) => e.stopPropagation()}>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
    />
  </label>
);

function ListView({
  folders, objects, prefix, siteUrl, transforms, cacheBusts,
  onFolderClick, onFileClick, onDeleteClick, onRotateClick, onDescribeClick,
  selected, onToggleSelect,
}: Omit<ObjectGridProps, "viewMode"> & { selected: Set<string>; onToggleSelect: (key: string, checked: boolean) => void }) {
  return (
    <div className="divide-y divide-slate-100/80">
      {folders.map((folder) => (
        <button
          key={folder}
          onClick={() => onFolderClick(folder)}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50"
        >
          <FolderIcon />
          <span className="text-sm font-medium text-slate-700">
            {folderName(folder, prefix)}
          </span>
        </button>
      ))}

      {objects.map((obj) => {
        const thumb = thumbUrl(siteUrl, transforms, obj.key, cacheBusts?.get(obj.key));
        return (
          <div
            key={obj.key}
            className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50"
          >
            <Checkbox checked={selected.has(obj.key)} onChange={(c) => onToggleSelect(obj.key, c)} />
            {thumb ? (
              <RetryImg
                src={thumb}
                alt=""
                className="h-8 w-8 shrink-0 rounded-md object-cover bg-slate-100"
              />
            ) : (
              <FileIcon />
            )}
            <button
              onClick={() => onFileClick(obj)}
              className="min-w-0 flex-1 text-left text-sm text-slate-700 transition hover:text-accent-600"
            >
              {fileName(obj.key, prefix)}
            </button>
            <span className="shrink-0 text-xs text-slate-400">
              {formatSize(obj.size)}
            </span>
            {onRotateClick && isImage(obj.key) && (
              <>
                <RotateCCWButton onClick={() => onRotateClick(obj.key, "ccw")} />
                <RotateCWButton onClick={() => onRotateClick(obj.key, "cw")} />
              </>
            )}
            {onDescribeClick && isImage(obj.key) && (
              <AnalyzeButton onClick={() => onDescribeClick(obj.key)} />
            )}
            <DeleteButton onClick={() => onDeleteClick(obj.key)} />
          </div>
        );
      })}
    </div>
  );
}

function GridView({
  folders, objects, prefix, siteUrl, transforms, dirConfigFile, cacheBusts,
  onFolderClick, onFileClick, onDeleteClick, onRotateClick, onDescribeClick,
  selected, onToggleSelect,
}: Omit<ObjectGridProps, "viewMode"> & { selected: Set<string>; onToggleSelect: (key: string, checked: boolean) => void }) {
  // Filter out config files from grid view
  const gridObjects = objects.filter((o) => !o.key.endsWith("/" + dirConfigFile) && !o.key.endsWith(dirConfigFile));

  return (
    <div>
      {folders.length > 0 && (
        <div className="border-b border-slate-100 p-3">
          <div className="flex flex-wrap gap-2">
            {folders.map((folder) => (
              <button
                key={folder}
                onClick={() => onFolderClick(folder)}
                className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm transition hover:bg-slate-100"
              >
                <FolderIcon />
                <span className="font-medium text-slate-700">
                  {folderName(folder, prefix)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 p-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {gridObjects.map((obj) => {
          const thumb = thumbUrl(siteUrl, transforms, obj.key, cacheBusts?.get(obj.key));
          const name = fileName(obj.key, prefix);
          const isSelected = selected.has(obj.key);
          return (
            <div key={obj.key} className="group relative">
              <button
                onClick={() => onFileClick(obj)}
                className={`block w-full overflow-hidden rounded-lg bg-slate-100 shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-1 ${isSelected ? "ring-2 ring-accent-500" : ""}`}
                style={{ aspectRatio: "1" }}
              >
                {thumb ? (
                  <RetryImg
                    src={thumb}
                    alt={name}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2">
                    <FileIcon />
                    <span className="text-[10px] text-slate-400 truncate w-full text-center">
                      {name}
                    </span>
                  </div>
                )}
              </button>
              <div className={`absolute left-1 top-1 transition-opacity duration-150 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                <span className="inline-flex rounded-md bg-white/90 shadow-sm backdrop-blur-sm p-0.5">
                  <Checkbox checked={isSelected} onChange={(c) => onToggleSelect(obj.key, c)} />
                </span>
              </div>
              <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {onRotateClick && isImage(obj.key) && (
                  <span className="inline-flex rounded-md bg-white/90 shadow-sm backdrop-blur-sm">
                    <RotateCCWButton onClick={() => onRotateClick(obj.key, "ccw")} />
                    <RotateCWButton onClick={() => onRotateClick(obj.key, "cw")} />
                  </span>
                )}
                {onDescribeClick && isImage(obj.key) && (
                  <span className="inline-flex rounded-md bg-white/90 shadow-sm backdrop-blur-sm">
                    <AnalyzeButton onClick={() => onDescribeClick(obj.key)} />
                  </span>
                )}
                <span className="inline-flex rounded-md bg-white/90 shadow-sm backdrop-blur-sm">
                  <DeleteButton onClick={() => onDeleteClick(obj.key)} />
                </span>
              </div>
              <p className="mt-1 truncate px-0.5 text-[11px] text-slate-500" title={name}>
                {name}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ObjectGrid(props: ObjectGridProps) {
  const { folders, objects, viewMode, isReordering, onOrderChange, prefix, siteUrl, transforms, onBulkDelete } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const onToggleSelect = useCallback((key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(objects.map((o) => o.key)));
  }, [objects]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  if (folders.length === 0 && objects.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-slate-400">
        This folder is empty
      </div>
    );
  }

  if (isReordering && viewMode === "grid" && onOrderChange) {
    return (
      <div>
        {folders.length > 0 && (
          <div className="border-b border-slate-100 p-3">
            <div className="flex flex-wrap gap-2">
              {folders.map((folder) => (
                <div
                  key={folder}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm opacity-40"
                >
                  <FolderIcon />
                  <span className="font-medium text-slate-700">
                    {folderName(folder, prefix)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <SortableGridView
          objects={objects}
          prefix={prefix}
          siteUrl={siteUrl}
          transforms={transforms}
          onOrderChange={onOrderChange}
        />
      </div>
    );
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="flex items-center gap-3 border-b border-slate-100 bg-accent-50/50 px-4 py-2">
          <span className="text-sm font-medium text-accent-700">
            {selected.size} selected
          </span>
          <button
            onClick={selectAll}
            className="text-xs text-accent-600 transition hover:text-accent-800"
          >
            Select all
          </button>
          <button
            onClick={clearSelection}
            className="text-xs text-slate-500 transition hover:text-slate-700"
          >
            Clear
          </button>
          <div className="flex-1" />
          {onBulkDelete && (
            <button
              onClick={() => { onBulkDelete(Array.from(selected)); clearSelection(); }}
              className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-red-700"
            >
              Delete {selected.size} file{selected.size === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}
      {viewMode === "grid"
        ? <GridView {...props} selected={selected} onToggleSelect={onToggleSelect} />
        : <ListView {...props} selected={selected} onToggleSelect={onToggleSelect} />
      }
    </>
  );
}
