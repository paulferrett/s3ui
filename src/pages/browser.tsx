import { useState, useCallback } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useObjects, useAuthInfo, type S3Object } from "../api/queries";
import { useAuth } from "../auth/use-token";
import { Breadcrumb } from "../components/breadcrumb";
import { ObjectGrid } from "../components/object-grid";
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

  const { data, isLoading, error } = useObjects(bucket, prefix);

  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);

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

  return (
    <div className="mx-auto min-h-screen max-w-4xl p-4">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          S3 Asset Manager
        </h1>
        <div className="flex items-center gap-3">
          {buckets.length > 1 && (
            <select
              value={bucket}
              onChange={(e) => onBucketChange(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Breadcrumb + actions */}
      <div className="mb-4 flex items-center justify-between">
        <Breadcrumb prefix={prefix} onNavigate={onNavigate} />
        <button
          onClick={() => setShowCreateFolder(true)}
          className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
        >
          New Folder
        </button>
      </div>

      {/* Object list */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white">
        {isLoading && (
          <div className="py-8 text-center text-gray-400">Loading...</div>
        )}
        {error && (
          <div className="py-8 text-center text-red-500">
            {error instanceof Error ? error.message : "Failed to load"}
          </div>
        )}
        {data && (
          <ObjectGrid
            folders={data.folders}
            objects={data.objects}
            prefix={prefix}
            onFolderClick={onNavigate}
            onFileClick={(obj: S3Object) => setPreviewKey(obj.key)}
            onDeleteClick={(key: string) => setDeleteKey(key)}
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
    </div>
  );
}
