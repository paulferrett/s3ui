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
  onFolderClick: (folder: string) => void;
  onFileClick: (obj: S3Object) => void;
  onDeleteClick: (key: string) => void;
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

function thumbUrl(siteUrl: string, transforms: TransformInfo[], key: string): string | null {
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
  return url;
}

const FolderIcon = () => (
  <svg className="h-5 w-5 shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
  </svg>
);

const FileIcon = () => (
  <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
    title="Delete"
  >
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  </button>
);

function ListView({
  folders, objects, prefix, siteUrl, transforms,
  onFolderClick, onFileClick, onDeleteClick,
}: Omit<ObjectGridProps, "viewMode">) {
  return (
    <div className="divide-y divide-gray-100">
      {folders.map((folder) => (
        <button
          key={folder}
          onClick={() => onFolderClick(folder)}
          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50"
        >
          <FolderIcon />
          <span className="text-sm font-medium text-gray-900">
            {folderName(folder, prefix)}
          </span>
        </button>
      ))}

      {objects.map((obj) => {
        const thumb = thumbUrl(siteUrl, transforms, obj.key);
        return (
          <div
            key={obj.key}
            className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50"
          >
            {thumb ? (
              <RetryImg
                src={thumb}
                alt=""
                className="h-8 w-8 shrink-0 rounded object-cover bg-gray-100"
              />
            ) : (
              <FileIcon />
            )}
            <button
              onClick={() => onFileClick(obj)}
              className="min-w-0 flex-1 text-left text-sm text-gray-900 hover:text-indigo-600 hover:underline"
            >
              {fileName(obj.key, prefix)}
            </button>
            <span className="shrink-0 text-xs text-gray-400">
              {formatSize(obj.size)}
            </span>
            <DeleteButton onClick={() => onDeleteClick(obj.key)} />
          </div>
        );
      })}
    </div>
  );
}

function GridView({
  folders, objects, prefix, siteUrl, transforms,
  onFolderClick, onFileClick, onDeleteClick,
}: Omit<ObjectGridProps, "viewMode">) {
  return (
    <div>
      {folders.length > 0 && (
        <div className="border-b border-gray-100 p-3">
          <div className="flex flex-wrap gap-2">
            {folders.map((folder) => (
              <button
                key={folder}
                onClick={() => onFolderClick(folder)}
                className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                <FolderIcon />
                <span className="font-medium text-gray-900">
                  {folderName(folder, prefix)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1 p-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {objects.map((obj) => {
          const thumb = thumbUrl(siteUrl, transforms, obj.key);
          const name = fileName(obj.key, prefix);
          return (
            <div key={obj.key} className="group relative">
              <button
                onClick={() => onFileClick(obj)}
                className="block w-full overflow-hidden rounded-md bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ aspectRatio: "1" }}
              >
                {thumb ? (
                  <RetryImg
                    src={thumb}
                    alt={name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2">
                    <FileIcon />
                    <span className="text-[10px] text-gray-400 truncate w-full text-center">
                      {name}
                    </span>
                  </div>
                )}
              </button>
              <div className="absolute right-1 top-1 opacity-0 transition group-hover:opacity-100">
                <DeleteButton onClick={() => onDeleteClick(obj.key)} />
              </div>
              <p className="mt-0.5 truncate px-0.5 text-[10px] text-gray-500" title={name}>
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
  const { folders, objects, viewMode, isReordering, onOrderChange, prefix, siteUrl, transforms } = props;

  if (folders.length === 0 && objects.length === 0) {
    return (
      <div className="py-12 text-center text-gray-400">
        This folder is empty
      </div>
    );
  }

  if (isReordering && viewMode === "grid" && onOrderChange) {
    return (
      <div>
        {folders.length > 0 && (
          <div className="border-b border-gray-100 p-3">
            <div className="flex flex-wrap gap-2">
              {folders.map((folder) => (
                <div
                  key={folder}
                  className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-sm opacity-50"
                >
                  <FolderIcon />
                  <span className="font-medium text-gray-900">
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

  return viewMode === "grid" ? <GridView {...props} /> : <ListView {...props} />;
}
