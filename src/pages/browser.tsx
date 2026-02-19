import { useState, useCallback, useMemo, useEffect } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useObjects, useAuthInfo, useSaveDirConfig, useDeleteObject, useRotateImage, useDescribeImage, type S3Object } from "../api/queries";
import { useAuth } from "../auth/use-token";
import { Breadcrumb } from "../components/breadcrumb";
import { ObjectGrid, type ViewMode } from "../components/object-grid";
import { UploadZone } from "../components/upload-zone";
import { PreviewModal } from "../components/preview-modal";
import { DeleteDialog } from "../components/delete-dialog";
import { CreateFolderDialog } from "../components/create-folder-dialog";

export function BrowserPage() {
  const search = useSearch({ from: "/" }) as Record<string, string>;
  const navigate = useNavigate();
  const { data: authInfo } = useAuthInfo();
  const { logout } = useAuth();

  const buckets = authInfo?.buckets ?? [];
  const bucket = search.bucket ?? buckets[0] ?? "";
  const prefix = search.prefix ?? "";
  const siteUrl = authInfo?.siteUrl ?? "";
  const transforms = authInfo?.transforms ?? [];

  const { data, isLoading, error } = useObjects(bucket, prefix);

  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [bulkDeleteKeys, setBulkDeleteKeys] = useState<string[] | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [isReordering, setIsReordering] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const saveDirConfig = useSaveDirConfig();
  const deleteMutation = useDeleteObject();
  const rotateMutation = useRotateImage();
  const describeMutation = useDescribeImage();
  const [cacheBusts, setCacheBusts] = useState<Map<string, number>>(new Map());
  const dirConfigFile = authInfo?.dirConfigFile ?? ".s3ui.json";

  const setParams = useCallback(
    (params: Record<string, string>) => {
      const current = { bucket, prefix, ...params };
      navigate({
        to: "/",
        search: current,
        replace: true,
      });
    },
    [bucket, prefix, navigate],
  );

  const onNavigate = useCallback(
    (newPrefix: string) => setParams({ prefix: newPrefix }),
    [setParams],
  );

  const onBucketChange = useCallback(
    (newBucket: string) => setParams({ bucket: newBucket, prefix: "" }),
    [setParams],
  );

  // Reset reorder mode on directory change
  useEffect(() => {
    setIsReordering(false);
    setPendingOrder(null);
  }, [prefix]);

  const handleOrderChange = useCallback((order: string[]) => {
    setPendingOrder(order);
  }, []);

  const handleSaveOrder = useCallback(async () => {
    if (!pendingOrder) return;
    await saveDirConfig.mutateAsync({
      bucket,
      prefix,
      config: { order: pendingOrder },
    });
    setIsReordering(false);
    setPendingOrder(null);
  }, [bucket, prefix, pendingOrder, saveDirConfig]);

  const handleCancelReorder = useCallback(() => {
    setIsReordering(false);
    setPendingOrder(null);
  }, []);

  const displayObjects = useMemo(() => {
    if (!data?.objects || !pendingOrder) return data?.objects ?? [];
    const byFilename = new Map(data.objects.map((o) => [o.key.slice(prefix.length), o]));
    const ordered: S3Object[] = [];
    for (const name of pendingOrder) {
      const obj = byFilename.get(name);
      if (obj) {
        ordered.push(obj);
        byFilename.delete(name);
      }
    }
    // Append any remaining objects not in pendingOrder
    for (const obj of byFilename.values()) {
      ordered.push(obj);
    }
    return ordered;
  }, [data?.objects, pendingOrder, prefix]);

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-base font-medium tracking-tight text-slate-800">
          Assets
        </h1>
        <div className="flex items-center gap-4">
          {buckets.length > 1 && (
            <select
              value={bucket}
              onChange={(e) => onBucketChange(e.target.value)}
              className="rounded-lg border-0 bg-white/80 px-3 py-1.5 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-accent-500"
            >
              {buckets.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={logout}
            className="text-xs font-medium text-slate-400 transition hover:text-slate-600"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Breadcrumb + actions */}
      <div className="mb-5 flex items-center justify-between">
        <Breadcrumb prefix={prefix} onNavigate={onNavigate} />
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex overflow-hidden rounded-lg bg-white/80 shadow-sm ring-1 ring-slate-200">
            <button
              onClick={() => setViewMode("list")}
              className={`px-2.5 py-1.5 transition ${viewMode === "list" ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-600"}`}
              title="List view"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`px-2.5 py-1.5 transition ${viewMode === "grid" ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-600"}`}
              title="Grid view"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            </button>
          </div>
          {isReordering ? (
            <>
              <button
                onClick={handleSaveOrder}
                disabled={!pendingOrder || saveDirConfig.isPending}
                className="rounded-lg bg-accent-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-700 disabled:opacity-50"
              >
                {saveDirConfig.isPending ? "Saving..." : "Save Order"}
              </button>
              <button
                onClick={handleCancelReorder}
                className="rounded-lg bg-white/80 px-3.5 py-1.5 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-white"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {viewMode === "grid" && (data?.objects?.length ?? 0) > 1 && (
                <button
                  onClick={() => setIsReordering(true)}
                  className="rounded-lg bg-white/80 px-3.5 py-1.5 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-white"
                >
                  Reorder
                </button>
              )}
              <button
                onClick={() => setShowCreateFolder(true)}
                className="rounded-lg bg-white/80 px-3.5 py-1.5 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-white"
              >
                New Folder
              </button>
            </>
          )}
        </div>
      </div>

      {/* Object list */}
      <div className="mb-6 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {isLoading && (
          <div className="py-12 text-center text-sm text-slate-400">Loading...</div>
        )}
        {error && (
          <div className="py-12 text-center text-sm text-red-500">
            {error instanceof Error ? error.message : "Failed to load"}
          </div>
        )}
        {data && (
          <ObjectGrid
            folders={data.folders}
            objects={displayObjects}
            prefix={prefix}
            viewMode={viewMode}
            siteUrl={siteUrl}
            transforms={transforms}
            dirConfigFile={dirConfigFile}
            onFolderClick={onNavigate}
            onFileClick={(obj: S3Object) => setPreviewKey(obj.key)}
            onDeleteClick={(key: string) => setDeleteKey(key)}
            onRotateClick={(key: string, direction: "cw" | "ccw") =>
              rotateMutation.mutate({ bucket, key, direction }, {
                onSuccess: () => {
                  // Wait for transform Lambda to regenerate thumbnails, then bust cache
                  setTimeout(() => {
                    setCacheBusts((prev) => new Map(prev).set(key, Date.now()));
                  }, 5000);
                },
              })
            }
            onDescribeClick={(key: string) =>
              describeMutation.mutate({ bucket, key })
            }
            cacheBusts={cacheBusts}
            onBulkDelete={(keys: string[]) => setBulkDeleteKeys(keys)}
            isReordering={isReordering}
            onOrderChange={handleOrderChange}
          />
        )}
      </div>

      {/* Upload zone */}
      {bucket && <UploadZone bucket={bucket} prefix={prefix} />}

      {/* Modals */}
      {previewKey && (
        <PreviewModal
          bucket={bucket}
          fileKey={previewKey}
          onClose={() => setPreviewKey(null)}
        />
      )}
      {deleteKey && (
        <DeleteDialog
          bucket={bucket}
          fileKey={deleteKey}
          onClose={() => setDeleteKey(null)}
        />
      )}
      {showCreateFolder && (
        <CreateFolderDialog
          bucket={bucket}
          prefix={prefix}
          onClose={() => setShowCreateFolder(false)}
        />
      )}
      {bulkDeleteKeys && bulkDeleteKeys.length > 0 && (
        <BulkDeleteDialog
          count={bulkDeleteKeys.length}
          onConfirm={async () => {
            for (const key of bulkDeleteKeys) {
              await deleteMutation.mutateAsync({ bucket, key });
            }
            setBulkDeleteKeys(null);
          }}
          onClose={() => setBulkDeleteKeys(null)}
        />
      )}
    </div>
  );
}

function BulkDeleteDialog({ count, onConfirm, onClose }: { count: number; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [loading, setLoading] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-sm font-medium text-slate-800">
          Delete {count} file{count === 1 ? "" : "s"}?
        </h2>
        <p className="mb-5 text-sm text-slate-500">
          This will permanently delete the selected files. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={async () => { setLoading(true); await onConfirm(); }}
            disabled={loading}
            className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Deleting..." : `Delete ${count} file${count === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
