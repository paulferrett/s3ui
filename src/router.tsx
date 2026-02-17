import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from "@tanstack/react-router";
import { ProtectedRoute } from "./auth/guard";
import { BrowserPage } from "./pages/browser";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const browserRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <ProtectedRoute>
      <BrowserPage />
    </ProtectedRoute>
  ),
});

const routeTree = rootRoute.addChildren([browserRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
