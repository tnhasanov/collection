import type { Metadata } from "next";
import "@fontsource-variable/inter/wght.css";
import "./globals.css";
import { currentLocale } from "@/i18n/locale";

export const metadata: Metadata = {
  title: { default: "ATB Collections", template: "%s · ATB Collections" },
  description: "Internal collections operating layer for unsecured AZN consumer cash loans (synthetic demo)",
  icons: { icon: "/brand/atb-logo.svg" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await currentLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
