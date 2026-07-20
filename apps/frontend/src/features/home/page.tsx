import localFont from "next/font/local";

import { HomeDashboard } from "@/features/home/components/home-dashboard";

const pretendard = localFont({
  display: "swap",
  src: "./assets/fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920"
});

export function HomePage() {
  return (
    <div className={`${pretendard.className} flex min-h-0 flex-1 flex-col`}>
      <HomeDashboard />
    </div>
  );
}
