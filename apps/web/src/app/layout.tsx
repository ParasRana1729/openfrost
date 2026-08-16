import type { Metadata } from "next";
import { getWebEnv } from "../env";

const env = getWebEnv();

export const metadata: Metadata = {
  title: "OpenFrost Control Center",
  description: "Local AI operating system dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body data-openfrost-api-url={env.OPENFROST_API_URL}>{children}</body>
    </html>
  );
}
