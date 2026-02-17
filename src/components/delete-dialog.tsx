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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-sm font-medium text-gray-900">
          Delete file?
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          Are you sure you want to delete{" "}
          <span className="font-medium text-gray-700">
            {nameFromKey(fileKey)}
          </span>
          ? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
