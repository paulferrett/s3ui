import { useEffect, useState } from "react";
import { useAuthInfo, type TransformInfo } from "../api/queries";

interface PreviewModalProps {
  bucket: string;
  fileKey: string;
  onClose: () => void;
}

function isImage(key: string): boolean {
  return /\.(jpe?g|png|gif|webp|svg|bmp|ico|avif|tiff?)$/i.test(key);
}

function nameFromKey(key: string): string {
  return key.split("/").pop() ?? key;
}

/** Build CDN URL for a transform, replacing extension if transform has a format. */
function transformUrl(siteUrl: string, transformKey: string, key: string, format?: string): string {
  let out = `${siteUrl}/${transformKey}/${key}`;
  if (format) {
    const lastDot = out.lastIndexOf(".");
    if (lastDot !== -1) {
      out = `${out.substring(0, lastDot)}.${format}`;
    }
  }
  return out;
}

function transformLabel(t: TransformInfo): string {
  const parts: string[] = [t.key];
  if (t.width && t.height) parts.push(`${t.width}x${t.height}`);
  else if (t.width) parts.push(`${t.width}w`);
  else if (t.height) parts.push(`${t.height}h`);
  if (t.format) parts.push(t.format);
  return parts.join(" · ");
}

type ViewOption = { label: string; url: string };

export function PreviewModal({ fileKey, onClose }: PreviewModalProps) {
  const { data: authInfo } = useAuthInfo();
  const siteUrl = authInfo?.siteUrl ?? "";
  const transforms = authInfo?.transforms ?? [];

  // Build view options: original + each transform
  const views: ViewOption[] = [];
  if (siteUrl) {
    views.push({ label: "Original", url: `${siteUrl}/${fileKey}` });
    for (const t of transforms) {
      views.push({
        label: transformLabel(t),
        url: transformUrl(siteUrl, t.key, fileKey, t.format),
      });
    }
  }

  // Default to lg, then first transform, then original
  const defaultIndex = views.findIndex((v) => v.label.startsWith("lg"));
  const [activeIndex, setActiveIndex] = useState(defaultIndex >= 0 ? defaultIndex : views.length > 1 ? 1 : 0);

  const url = views[activeIndex]?.url ?? null;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700 truncate">
            {nameFromKey(fileKey)}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Size tabs */}
        {views.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1">
            {views.map((v, i) => (
              <button
                key={v.label}
                onClick={() => setActiveIndex(i)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                  i === activeIndex
                    ? "bg-accent-100 text-accent-700"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}

        {!url && (
          <div className="py-12 text-center text-sm text-slate-400">Loading...</div>
        )}

        {url && isImage(fileKey) && (
          <div className="flex justify-center rounded-lg bg-slate-50 p-4">
            <img
              src={url}
              alt={nameFromKey(fileKey)}
              className="max-h-[70vh] max-w-full rounded object-contain"
            />
          </div>
        )}

        {url && !isImage(fileKey) && (
          <div className="py-12 text-center">
            <p className="mb-4 text-sm text-slate-500">
              Preview not available for this file type.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-700"
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
              className="text-sm text-accent-600 transition hover:text-accent-700"
            >
              Open in new tab
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
