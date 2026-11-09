import type { Metadata, Viewport } from "next";
import { Noto_Sans, Varela_Round } from "next/font/google";
import "./globals.css";

const notoSans = Noto_Sans({
  variable: "--font-noto",
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["300", "400", "500", "700"],
});

const varelaRound = Varela_Round({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Language Caption — Từ đã lưu",
  description:
    "Saved Items for Language Caption (JA/EN/VI vocab via userVocab).",
};

export const viewport: Viewport = {
  themeColor: "#1a1c1f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${notoSans.variable} ${varelaRound.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-full w-full max-w-none flex-col bg-[#1a1c1f]">
        {children}
      </body>
    </html>
  );
}

