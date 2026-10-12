import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "ReachInbox | Cold Outreach Email Infrastructure",
  description: "Enterprise multi-sender cold outreach scheduler with automated pacing, provider throttling & deliverability safeguards.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body className={inter.className} style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
