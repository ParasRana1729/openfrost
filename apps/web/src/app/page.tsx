import { createHealthCheck } from "@openfrost/domain";
import { formatStatusLabel, getStatusBadgeClassName } from "@openfrost/ui";
import { getWebEnv } from "../env";

export default function HomePage() {
  const env = getWebEnv();
  const health = createHealthCheck("web", "ok");
  const badgeClassName = getStatusBadgeClassName("success");

  return (
    <main style={{ fontFamily: "Segoe UI, sans-serif", padding: "2rem" }}>
      <h1>{formatStatusLabel("OpenFrost Control Center")}</h1>
      <p>Local dashboard scaffold is running.</p>
      <p>
        API URL: <code>{env.OPENFROST_API_URL}</code>
      </p>
      <p className={badgeClassName}>
        Service: {health.service} · Status: {health.status}
      </p>
    </main>
  );
}
