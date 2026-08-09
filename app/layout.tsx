import type { Metadata, Viewport } from "next";
import "./globals.css";
import { dirFor } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { LocaleToggle } from "@/components/LocaleToggle";

export const metadata: Metadata = {
  title: "Picked Up — Pickup Sports Groups",
  description:
    "Run persistent basketball, soccer, and volleyball groups with friends: peer ratings, balanced gameday teams, and archetypes.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Picked Up",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getServerLocale();

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body>
        <LocaleProvider locale={locale}>
          <div className="flex justify-end px-4 pt-2">
            <LocaleToggle locale={locale} />
          </div>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
