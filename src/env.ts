export const API_URL = import.meta.env.VITE_API_URL as string | undefined ?? "";
export const BASE_PATH = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
