interface BreadcrumbProps {
  prefix: string;
  onNavigate: (prefix: string) => void;
}

export function Breadcrumb({ prefix, onNavigate }: BreadcrumbProps) {
  const parts = prefix.split("/").filter(Boolean);

  return (
    <nav className="flex items-center gap-1 text-sm text-gray-600">
      <button
        onClick={() => onNavigate("")}
        className="hover:text-gray-900 hover:underline"
      >
        Root
      </button>
      {parts.map((part, i) => {
        const path = parts.slice(0, i + 1).join("/") + "/";
        return (
          <span key={path} className="flex items-center gap-1">
            <span className="text-gray-400">/</span>
            <button
              onClick={() => onNavigate(path)}
              className="hover:text-gray-900 hover:underline"
            >
              {part}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
