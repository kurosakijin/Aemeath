import { env } from "cloudflare:workers";

export function runtimeEnv(name: string) {
  const workerValue = (env as Record<string, unknown> | undefined)?.[name];
  return typeof workerValue === "string" && workerValue ? workerValue : process.env[name];
}
