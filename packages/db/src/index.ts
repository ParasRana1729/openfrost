import { createHealthCheck } from "@openfrost/domain";

export type DatabaseStatus = {
  ready: boolean;
  message: string;
};

export function getDatabaseStatus(): DatabaseStatus {
  return {
    ready: false,
    message: "Database layer scaffolded; migrations arrive in a later issue.",
  };
}

export function getDatabaseHealthCheck() {
  return createHealthCheck("db", "degraded");
}
