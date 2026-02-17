import { useEffect, useState } from "react";
import { usePresignGet } from "../api/queries";

interface PreviewModalProps {
  bucket: string;
  fileKey: string;
  onClose: () => void;
}

function isImage(key: string): boolean {
  return /\.(jpe?g|png|gif|webp|svg|bmp|ico)$/i.test(key);
}

function nameFromKey(key: string): string {
  return key.split("/").pop() ?? key;
}

export function PreviewModal({ bucket, fileKey, onClose }: PreviewModalProps) {
  const presignGet = usePresignGet();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    presignGet.mutateAsync({ bucket, key: fileKey }).then((r) => setUrl(r.url));
  }, [bucket, fileKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-900 truncate">
            {nameFromKey(fileKey)}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!url && (
          <div className="py-8 text-center text-gray-400">Loading...</div>
        )}

        {url && isImage(fileKey) && (
          <img
            src={url}
            alt={nameFromKey(fileKey)}
            className="max-h-[70vh] w-full object-contain"
          />
        )}

        {url && !isImage(fileKey) && (
          <div className="py-8 text-center">
            <p className="mb-4 text-sm text-gray-500">
              Preview not available for this file type.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Download
            </a>
          </div>
        )}

        {url && (
          <div className="mt-4 flex justify-end">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              Open in new tab
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
