import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pi Studio Dev",
  description: "Pi Studio Dev — Next.js template",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
