import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface TransformInfo {
  key: string;
  width?: number;
  height?: number;
  format?: string;
}

export interface AuthInfo {
  mode: string;
  buckets: string[];
  dirConfigFile: string;
  uploadConcurrency: number;
  siteUrl?: string;
  transforms?: TransformInfo[];
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string;
}

export interface ObjectsResponse {
  folders: string[];
  objects: S3Object[];
}

export function useAuthInfo() {
  return useQuery({
    queryKey: ["auth-info"],
    queryFn: () => apiFetch<AuthInfo>("/auth-info"),
    staleTime: Infinity,
  });
}

export function useObjects(bucket: string, prefix: string) {
  return useQuery({
    queryKey: ["objects", bucket, prefix],
    queryFn: () =>
      apiFetch<ObjectsResponse>(
        `/objects?bucket=${encodeURIComponent(bucket)}&prefix=${encodeURIComponent(prefix)}`,
      ),
    enabled: !!bucket,
  });
}

export function usePresignGet() {
  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) =>
      apiFetch<{ url: string }>(
        `/presign/get?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`,
      ),
  });
}

export function usePresignPut() {
  return useMutation({
    mutationFn: ({
      bucket,
      key,
      contentType,
    }: {
      bucket: string;
      key: string;
      contentType: string;
    }) =>
      apiFetch<{ url: string; key: string }>("/presign/put", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket, key, contentType }),
      }),
  });
}

export function useSaveDirConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bucket,
      prefix,
      config,
    }: {
      bucket: string;
      prefix: string;
      config: { order?: string[] };
    }) =>
      apiFetch("/dir-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket, prefix, config }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objects"] });
    },
  });
}

export function useDeleteObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) =>
      apiFetch("/objects?bucket=" + encodeURIComponent(bucket) + "&key=" + encodeURIComponent(key), {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objects"] });
    },
  });
}

export function useRotateImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bucket,
      key,
      direction,
    }: {
      bucket: string;
      key: string;
      direction: "cw" | "ccw";
    }) =>
      apiFetch("/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket, key, direction }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objects"] });
    },
  });
}

export function useDescribeImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) =>
      apiFetch<{ ok: boolean; meta: unknown }>("/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket, key }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["objects"] });
    },
  });
}
