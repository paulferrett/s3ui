import type { S3Object } from "../api/queries";

interface ObjectGridProps {
  folders: string[];
  objects: S3Object[];
  prefix: string;
  onFolderClick: (folder: string) => void;
  onFileClick: (obj: S3Object) => void;
  onDeleteClick: (key: string) => void;
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

export function ObjectGrid({
  folders,
  objects,
  prefix,
  onFolderClick,
  onFileClick,
  onDeleteClick,
}: ObjectGridProps) {
  if (folders.length === 0 && objects.length === 0) {
    return (
      <div className="py-12 text-center text-gray-400">
        This folder is empty
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {folders.map((folder) => (
        <button
          key={folder}
          onClick={() => onFolderClick(folder)}
          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50"
        >
          <svg
            className="h-5 w-5 shrink-0 text-amber-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          <span className="text-sm font-medium text-gray-900">
            {folderName(folder, prefix)}
          </span>
        </button>
      ))}

      {objects.map((obj) => (
        <div
          key={obj.key}
          className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50"
        >
          <svg
            className="h-5 w-5 shrink-0 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          <button
            onClick={() => onFileClick(obj)}
            className="min-w-0 flex-1 text-left text-sm text-gray-900 hover:text-indigo-600 hover:underline"
          >
            {fileName(obj.key, prefix)}
          </button>
          <span className="shrink-0 text-xs text-gray-400">
            {formatSize(obj.size)}
          </span>
          <button
            onClick={() => onDeleteClick(obj.key)}
            className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
            title="Delete"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
