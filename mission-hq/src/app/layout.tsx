import type { Metadata } from "next";
import { Poppins, JetBrains_Mono, Geist } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme";
import { FeedbackWrapper } from "@/components/FeedbackWrapper";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

// The member view's typeface (Petrol & Oat design). Scoped to that view through
// its own font-family, so the admin dashboard keeps Poppins.
const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MissionHQ Office Intelligence",
  description: "Real-time office attendance tracking & compliance analytics",
  applicationName: "MissionHQ",
  appleWebApp: { title: "MissionHQ", statusBarStyle: "black" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${poppins.variable} ${jetbrainsMono.variable} ${geist.variable} font-sans antialiased`}>
        <ThemeProvider>
          <FeedbackWrapper>{children}</FeedbackWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
