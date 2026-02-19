import { useState, useCallback, useRef, useEffect } from "react";
import { usePresignPut, useAuthInfo } from "../api/queries";
import { useQueryClient } from "@tanstack/react-query";

interface UploadZoneProps {
  bucket: string;
  prefix: string;
}

interface UploadProgress {
  name: string;
  targetPrefix: string;
  progress: number;
  done: boolean;
  doneAt?: number;
  error?: string;
}

/** File with a relative path and the target prefix captured at drop time. */
interface FileWithPath {
  file: File;
  /** S3 key relative to the target prefix, e.g. "subfolder/photo.jpg" */
  relativePath: string;
  /** The S3 prefix that was active when this file was queued. */
  targetPrefix: string;
}

/** Recursively read all files from a FileSystemDirectoryEntry. */
function readDirectoryEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((entries) => {
        if (entries.length === 0) { resolve(all); return; }
        all.push(...entries);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function collectFiles(entry: FileSystemEntry, basePath: string): Promise<Omit<FileWithPath, "targetPrefix">[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    return [{ file, relativePath: basePath + file.name }];
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const children = await readDirectoryEntries(dirEntry);
    const results: Omit<FileWithPath, "targetPrefix">[] = [];
    for (const child of children) {
      results.push(...await collectFiles(child, basePath + dirEntry.name + "/"));
    }
    return results;
  }
  return [];
}

/** Extract files from a drop event, preserving folder structure via webkitGetAsEntry. */
async function filesFromDataTransfer(dt: DataTransfer): Promise<{ files: Omit<FileWithPath, "targetPrefix">[]; folders: string[] }> {
  const files: Omit<FileWithPath, "targetPrefix">[] = [];
  const folders = new Set<string>();

  // Try webkitGetAsEntry for folder support
  const items = Array.from(dt.items);
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];

  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isDirectory) {
        // Collect all nested folders
        const collected = await collectFiles(entry, "");
        files.push(...collected);
        // Gather unique folder paths
        const seen = new Set<string>();
        for (const f of collected) {
          const parts = f.relativePath.split("/");
          for (let i = 1; i < parts.length; i++) {
            const folderPath = parts.slice(0, i).join("/") + "/";
            if (!seen.has(folderPath)) { seen.add(folderPath); folders.add(folderPath); }
          }
        }
      } else {
        const collected = await collectFiles(entry, "");
        files.push(...collected);
      }
    }
  } else {
    // Fallback: plain file list (no folder structure)
    for (const f of Array.from(dt.files)) {
      files.push({ file: f, relativePath: f.name });
    }
  }

  return { files, folders: Array.from(folders) };
}

export function UploadZone({ bucket, prefix }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [fullPageDragging, setFullPageDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const presignPut = usePresignPut();
  const { data: authInfo } = useAuthInfo();
  const maxConcurrent = authInfo?.uploadConcurrency ?? 6;
  const dirConfigFile = authInfo?.dirConfigFile ?? ".s3ui.json";
  const qc = useQueryClient();
  const activeRef = useRef(0);
  const queueRef = useRef<FileWithPath[]>([]);
  const dragCounterRef = useRef(0);

  /** Create a folder marker (.s3ui.json) for a subfolder. */
  const createFolder = useCallback(
    async (folderPath: string) => {
      const key = prefix + folderPath + dirConfigFile;
      try {
        const { url } = await presignPut.mutateAsync({
          bucket, key, contentType: "application/json",
        });
        const body = JSON.stringify({ created: new Date().toISOString() }, null, 2);
        await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
      } catch {
        // folder creation is best-effort
      }
    },
    [bucket, prefix, dirConfigFile, presignPut],
  );

  const uploadFile = useCallback(
    async (item: FileWithPath) => {
      const key = item.targetPrefix + item.relativePath;
      const name = item.relativePath;

      setUploads((prev) => [...prev, { name, targetPrefix: item.targetPrefix, progress: 0, done: false }]);

      try {
        const { url } = await presignPut.mutateAsync({
          bucket,
          key,
          contentType: item.file.type || "application/octet-stream",
        });

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", url);
          xhr.setRequestHeader(
            "Content-Type",
            item.file.type || "application/octet-stream",
          );

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setUploads((prev) =>
                prev.map((u) =>
                  u.name === name ? { ...u, progress: pct } : u,
                ),
              );
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload failed: ${xhr.status}`));
          };
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.send(item.file);
        });

        setUploads((prev) =>
          prev.map((u) =>
            u.name === name ? { ...u, progress: 100, done: true, doneAt: Date.now() } : u,
          ),
        );
        qc.invalidateQueries({ queryKey: ["objects", bucket, item.targetPrefix] });
      } catch (err) {
        setUploads((prev) =>
          prev.map((u) =>
            u.name === name
              ? { ...u, error: err instanceof Error ? err.message : "Failed", doneAt: Date.now() }
              : u,
          ),
        );
      } finally {
        activeRef.current--;
        drainQueue();
      }
    },
    [bucket, presignPut, qc],
  );

  const drainQueue = useCallback(() => {
    while (activeRef.current < maxConcurrent && queueRef.current.length > 0) {
      activeRef.current++;
      uploadFile(queueRef.current.shift()!);
    }
  }, [uploadFile, maxConcurrent]);

  const enqueueFiles = useCallback(
    (files: FileWithPath[]) => {
      queueRef.current.push(...files);
      drainQueue();
    },
    [drainQueue],
  );

  /** Handle a drop with potential folder entries. Captures prefix at drop time. */
  const handleDropWithFolders = useCallback(
    async (dt: DataTransfer) => {
      const dropPrefix = prefix; // capture at drop time
      const { files, folders } = await filesFromDataTransfer(dt);
      // Create folder markers first (parallel, best-effort)
      if (folders.length > 0) {
        await Promise.all(folders.map((f) => createFolder(f)));
        // Small delay to let S3 propagate before listing
        await new Promise((r) => setTimeout(r, 500));
        await qc.invalidateQueries({ queryKey: ["objects", bucket, dropPrefix] });
      }
      // Stamp each file with the prefix that was active at drop time
      enqueueFiles(files.map((f) => ({ ...f, targetPrefix: dropPrefix })));
    },
    [prefix, createFolder, enqueueFiles, qc, bucket],
  );

  /** Handle plain file input (no folder structure). */
  const handleFileInput = useCallback(
    (fileList: FileList) => {
      const items: FileWithPath[] = Array.from(fileList).map((f) => ({ file: f, relativePath: f.name, targetPrefix: prefix }));
      enqueueFiles(items);
    },
    [enqueueFiles, prefix],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleDropWithFolders(e.dataTransfer);
    },
    [handleDropWithFolders],
  );

  // Full-page drag-and-drop: capture files dragged anywhere on screen
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer?.types.includes("Files")) {
        setFullPageDragging(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setFullPageDragging(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setFullPageDragging(false);
      if (e.dataTransfer) {
        handleDropWithFolders(e.dataTransfer);
      }
    };

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [handleDropWithFolders]);

  const clearDone = () => {
    setUploads((prev) => prev.filter((u) => !u.done && !u.error));
  };

  // Auto-remove completed/errored uploads after 30 seconds
  useEffect(() => {
    const hasDone = uploads.some((u) => u.done || u.error);
    if (!hasDone) return;
    const timer = setInterval(() => {
      const cutoff = Date.now() - 30_000;
      setUploads((prev) => prev.filter((u) => {
        if (u.done && u.doneAt && u.doneAt < cutoff) return false;
        if (u.error && u.doneAt && u.doneAt < cutoff) return false;
        return true;
      }));
    }, 5_000);
    return () => clearInterval(timer);
  }, [uploads]);

  return (
    <div className="space-y-3">
      {/* Full-page drop overlay */}
      {fullPageDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-accent-500/10 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-accent-400 bg-white/90 px-12 py-10 text-center shadow-lg">
            <svg className="mx-auto mb-3 h-10 w-10 text-accent-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
            </svg>
            <p className="text-lg font-medium text-accent-700">Drop files or folders to upload</p>
          </div>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
          dragging
            ? "border-accent-400 bg-accent-50"
            : "border-slate-200 hover:border-slate-300 hover:bg-white/60"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFileInput(e.target.files)}
        />
        <svg className="mx-auto mb-2 h-6 w-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
        </svg>
        <p className="text-sm text-slate-400">
          Drop files or folders here, or click to upload
        </p>
      </div>

      {uploads.length > 0 && (
        <div className="space-y-1.5 rounded-xl bg-white/80 p-3 shadow-sm ring-1 ring-slate-200/60">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Uploads</span>
            {uploads.some((u) => u.done || u.error) && (
              <button
                onClick={clearDone}
                className="text-xs text-slate-400 transition hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>
          {uploads.map((u) => (
            <div key={u.name} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-slate-600">
                {u.targetPrefix && (
                  <span className="text-slate-400">{u.targetPrefix}</span>
                )}
                {u.name}
              </span>
              {u.error ? (
                <span className="shrink-0 text-red-500">{u.error}</span>
              ) : u.done ? (
                <span className="shrink-0 text-emerald-600">Done</span>
              ) : (
                <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-accent-500 transition-all"
                    style={{ width: `${u.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
