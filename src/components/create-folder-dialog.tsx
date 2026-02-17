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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={handleCreate}
        className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-medium text-slate-800">
          New Folder
        </h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Folder name"
          autoFocus
          className="mb-4 w-full rounded-lg border-0 bg-slate-50 px-3 py-2 text-sm text-slate-800 ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-accent-500"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="rounded-lg bg-accent-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
