import { useState, useCallback, useRef } from "react";
import { usePresignPut, useAuthInfo } from "../api/queries";
import { useQueryClient } from "@tanstack/react-query";

interface UploadZoneProps {
  bucket: string;
  prefix: string;
}

interface UploadProgress {
  name: string;
  progress: number;
  done: boolean;
  error?: string;
}

export function UploadZone({ bucket, prefix }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const presignPut = usePresignPut();
  const { data: authInfo } = useAuthInfo();
  const maxConcurrent = authInfo?.uploadConcurrency ?? 6;
  const qc = useQueryClient();
  const activeRef = useRef(0);
  const queueRef = useRef<File[]>([]);

  const uploadFile = useCallback(
    async (file: File) => {
      const key = prefix + file.name;
      const name = file.name;

      setUploads((prev) => [...prev, { name, progress: 0, done: false }]);

      try {
        const { url } = await presignPut.mutateAsync({
          bucket,
          key,
          contentType: file.type || "application/octet-stream",
        });

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", url);
          xhr.setRequestHeader(
            "Content-Type",
            file.type || "application/octet-stream",
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
          xhr.send(file);
        });

        setUploads((prev) =>
          prev.map((u) =>
            u.name === name ? { ...u, progress: 100, done: true } : u,
          ),
        );
        qc.invalidateQueries({ queryKey: ["objects", bucket, prefix] });
      } catch (err) {
        setUploads((prev) =>
          prev.map((u) =>
            u.name === name
              ? { ...u, error: err instanceof Error ? err.message : "Failed" }
              : u,
          ),
        );
      } finally {
        activeRef.current--;
        drainQueue();
      }
    },
    [bucket, prefix, presignPut, qc],
  );

  const drainQueue = useCallback(() => {
    while (activeRef.current < maxConcurrent && queueRef.current.length > 0) {
      activeRef.current++;
      uploadFile(queueRef.current.shift()!);
    }
  }, [uploadFile, maxConcurrent]);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      queueRef.current.push(...Array.from(files));
      drainQueue();
    },
    [drainQueue],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const clearDone = () => {
    setUploads((prev) => prev.filter((u) => !u.done && !u.error));
  };

  return (
    <div className="space-y-3">
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
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <svg className="mx-auto mb-2 h-6 w-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
        </svg>
        <p className="text-sm text-slate-400">
          Drop files here or click to upload
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
