import { useContext, createContext, useCallback } from "react";

interface AuthContextValue {
  isAuthenticated: boolean;
  getToken: () => Promise<string | null>;
  login: (username?: string, password?: string) => Promise<void>;
  logout: () => void;
  mode: "auth0" | "setup" | "both" | null;
}

export const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  getToken: async () => null,
  login: async () => {},
  logout: () => {},
  mode: null,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function useGetAuthHeader() {
  const { getToken } = useAuth();
  return useCallback(async () => {
    const token = await getToken();
    return token;
  }, [getToken]);
}
