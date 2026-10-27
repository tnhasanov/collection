import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ATB Collections", template: "%s · ATB Collections" },
  description: "Internal collections operating layer for unsecured AZN consumer cash loans (synthetic demo)",
  icons: { icon: "/brand/atb-logo.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
