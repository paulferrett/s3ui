import { useState } from "react";
import { useDeleteObject } from "../api/queries";

interface DeleteDialogProps {
  bucket: string;
  fileKey: string;
  onClose: () => void;
}

function nameFromKey(key: string): string {
  return key.split("/").pop() ?? key;
}

export function DeleteDialog({ bucket, fileKey, onClose }: DeleteDialogProps) {
  const deleteMutation = useDeleteObject();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      await deleteMutation.mutateAsync({ bucket, key: fileKey });
      onClose();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

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
          Delete file?
        </h2>
        <p className="mb-5 text-sm text-slate-500">
          Are you sure you want to delete{" "}
          <span className="font-medium text-slate-700">
            {nameFromKey(fileKey)}
          </span>
          ? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
