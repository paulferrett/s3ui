import type { ReactNode } from "react";
import { useAuth } from "./use-token";
import { LoginPage } from "../pages/login";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
}
