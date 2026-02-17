import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { AuthContext } from "./use-token";
import { useAuthInfo } from "../api/queries";
import { setAuthHeaderProvider } from "../api/client";

// --- Setup (Basic) auth provider ---
function SetupAuthProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<string | null>(() => {
    return sessionStorage.getItem("s3m-basic-auth");
  });

  const isAuthenticated = !!credentials;

  const getToken = useCallback(async () => {
    return credentials ? `Basic ${credentials}` : null;
  }, [credentials]);

  const login = useCallback(async (username?: string, password?: string) => {
    if (!username || !password) throw new Error("Username and password required");
    const encoded = btoa(`${username}:${password}`);
    sessionStorage.setItem("s3m-basic-auth", encoded);
    setCredentials(encoded);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem("s3m-basic-auth");
    setCredentials(null);
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, getToken, login, logout, mode: "setup" as const }),
    [isAuthenticated, getToken, login, logout],
  );

  useEffect(() => {
    setAuthHeaderProvider(getToken);
  }, [getToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// --- Auth0 wrapper ---
function Auth0InnerProvider({
  children,
  mode,
}: {
  children: ReactNode;
  mode: "auth0" | "both";
}) {
  const { isAuthenticated, getAccessTokenSilently, loginWithRedirect, logout } =
    useAuth0();
  const [basicCreds, setBasicCreds] = useState<string | null>(() =>
    sessionStorage.getItem("s3m-basic-auth"),
  );

  const effectiveAuth = isAuthenticated || (mode === "both" && !!basicCreds);

  const getToken = useCallback(async () => {
    if (isAuthenticated) {
      const token = await getAccessTokenSilently();
      return `Bearer ${token}`;
    }
    if (basicCreds) return `Basic ${basicCreds}`;
    return null;
  }, [isAuthenticated, getAccessTokenSilently, basicCreds]);

  const doLogin = useCallback(
    async (username?: string, password?: string) => {
      if (username && password) {
        const encoded = btoa(`${username}:${password}`);
        sessionStorage.setItem("s3m-basic-auth", encoded);
        setBasicCreds(encoded);
      } else {
        await loginWithRedirect();
      }
    },
    [loginWithRedirect],
  );

  const doLogout = useCallback(() => {
    sessionStorage.removeItem("s3m-basic-auth");
    setBasicCreds(null);
    if (isAuthenticated) {
      logout({ logoutParams: { returnTo: window.location.origin } });
    }
  }, [isAuthenticated, logout]);

  const value = useMemo(
    () => ({
      isAuthenticated: effectiveAuth,
      getToken,
      login: doLogin,
      logout: doLogout,
      mode,
    }),
    [effectiveAuth, getToken, doLogin, doLogout, mode],
  );

  useEffect(() => {
    setAuthHeaderProvider(getToken);
  }, [getToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// --- Main provider that picks the right strategy ---
export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: authInfo, isLoading } = useAuthInfo();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const mode = authInfo?.mode as "auth0" | "setup" | "both" | undefined;

  if (mode === "setup" || !mode) {
    return <SetupAuthProvider>{children}</SetupAuthProvider>;
  }

  // Auth0 mode needs domain/audience — we'll get from env since they're baked in at build time
  // Actually for Auth0, the clientId is needed. Let's check if we have env vars.
  const domain = import.meta.env.VITE_AUTH0_DOMAIN as string | undefined;
  const audience = import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined;
  const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined;

  if (!domain || !audience || !clientId) {
    // Fall back to setup mode if Auth0 env vars aren't configured
    return <SetupAuthProvider>{children}</SetupAuthProvider>;
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience,
      }}
    >
      <Auth0InnerProvider mode={mode}>{children}</Auth0InnerProvider>
    </Auth0Provider>
  );
}
