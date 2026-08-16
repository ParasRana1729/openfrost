import { z } from "zod";

export const packageVersionSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.-]+)?$/),
});

export type PackageVersion = z.infer<typeof packageVersionSchema>;

export const healthStatusSchema = z.enum(["ok", "degraded", "down"]);

export const healthCheckSchema = z.object({
  service: z.string().min(1),
  status: healthStatusSchema,
  timestamp: z.string().datetime(),
});

export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export function createHealthCheck(service: string, status: HealthCheck["status"]): HealthCheck {
  return healthCheckSchema.parse({
    service,
    status,
    timestamp: new Date().toISOString(),
  });
}
