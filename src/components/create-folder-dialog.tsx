import { useState } from "react";
import { usePresignPut, useAuthInfo } from "../api/queries";
import { useQueryClient } from "@tanstack/react-query";

interface CreateFolderDialogProps {
  bucket: string;
  prefix: string;
  onClose: () => void;
}

export function CreateFolderDialog({
  bucket,
  prefix,
  onClose,
}: CreateFolderDialogProps) {
  const { data: authInfo } = useAuthInfo();
  const dirConfigFile = authInfo?.dirConfigFile ?? ".s3ui.json";
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const presignPut = usePresignPut();
  const qc = useQueryClient();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const folder = name.trim().replace(/\/+$/, "");
      const key = prefix + folder + "/" + dirConfigFile;
      const { url } = await presignPut.mutateAsync({
        bucket,
        key,
        contentType: "application/json",
      });
      const config = JSON.stringify(
        { created: new Date().toISOString() },
        null,
        2,
      );
      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: config,
      });
      qc.invalidateQueries({ queryKey: ["objects", bucket, prefix] });
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
      <form
        onSubmit={handleCreate}
        className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-medium text-gray-900">
          New Folder
        </h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Folder name"
          autoFocus
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
