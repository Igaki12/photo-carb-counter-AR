import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost:3000";
  const protocol = headerStore.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: "食品ARノギス | Photo Carb Counter",
    description: "AndroidのARノギスと計測マットで食品の体積・重量・炭水化物量を参考推定する研究用Webアプリ。",
    icons: { icon: "/assets/app-icon.png", shortcut: "/assets/app-icon.png", apple: "/assets/app-icon.png" },
    openGraph: {
      type: "website",
      locale: "ja_JP",
      title: "食品ARノギス",
      description: "食品だけを撮影し、実寸・体積・食品成分表から炭水化物量を推定。",
      images: [{ url: new URL("/og.png", metadataBase).toString(), width: 1536, height: 1024, alt: "食品ARノギス" }],
    },
    twitter: { card: "summary_large_image", title: "食品ARノギス", description: "Android対応の研究用カーボカウントWebアプリ", images: [new URL("/og.png", metadataBase).toString()] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
