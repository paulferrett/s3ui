import { useState } from "react";
import { useAuth } from "../auth/use-token";

export function LoginPage() {
  const { login, mode } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const showBasicForm = mode === "setup" || mode === "both";
  const showAuth0 = mode === "auth0" || mode === "both";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
    } catch {
      setError("Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 rounded-2xl bg-white p-8 shadow-lg ring-1 ring-black/5">
        <div className="text-center">
          <h1 className="text-lg font-medium tracking-tight text-slate-800">
            Assets
          </h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to continue</p>
        </div>

        {showAuth0 && (
          <button
            onClick={() => login()}
            className="w-full rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-700"
          >
            Sign in with Auth0
          </button>
        )}

        {showAuth0 && showBasicForm && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-3 text-slate-400">or</span>
            </div>
          </div>
        )}

        {showBasicForm && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border-0 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-accent-500"
              autoComplete="username"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border-0 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-accent-500"
              autoComplete="current-password"
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-900 disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
