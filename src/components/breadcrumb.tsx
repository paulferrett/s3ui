interface BreadcrumbProps {
  prefix: string;
  onNavigate: (prefix: string) => void;
}

export function Breadcrumb({ prefix, onNavigate }: BreadcrumbProps) {
  const parts = prefix.split("/").filter(Boolean);

  return (
    <nav className="flex items-center gap-1.5 text-sm">
      <button
        onClick={() => onNavigate("")}
        className="font-medium text-slate-500 transition hover:text-slate-800"
      >
        Root
      </button>
      {parts.map((part, i) => {
        const path = parts.slice(0, i + 1).join("/") + "/";
        const isLast = i === parts.length - 1;
        return (
          <span key={path} className="flex items-center gap-1.5">
            <span className="text-slate-300">/</span>
            <button
              onClick={() => onNavigate(path)}
              className={`transition ${isLast ? "font-medium text-slate-800" : "text-slate-500 hover:text-slate-800"}`}
            >
              {part}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
