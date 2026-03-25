import { useEffect, useState } from "react";
import Hero from "./components/Hero";
import Features from "./components/Features";
import HowItWorks from "./components/HowItWorks";
import WhyKiosk from "./components/WhyKiosk";
import Dock from "./components/Dock";
import Footer from "./components/Footer";

export default function App() {
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <div className="relative min-h-screen overflow-x-hidden" style={{ background: "var(--bg)" }}>
      {/* Global radial background glow */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, var(--glow) 0%, transparent 70%)",
        }}
      />

      <main className="relative z-10">
        <Hero />
        <Features />
        <HowItWorks />
        <WhyKiosk />
        <Footer />
      </main>

      {/* Signature floating dock */}
      <Dock dark={dark} setDark={setDark} />
    </div>
  );
}
