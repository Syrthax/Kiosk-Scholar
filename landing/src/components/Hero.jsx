import { motion } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import logo from "../assets/logo.jpeg";


const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.65, delay, ease: [0.22, 1, 0.36, 1] },
});

export default function Hero() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center px-6 pt-24 pb-16 text-center">
      {/* Ambient blobs */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 opacity-30 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse, var(--accent) 0%, transparent 70%)",
        }}
      />

      {/* Badge */}
      <motion.div {...fadeUp(0.1)}>
        <span
          className="glass mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium tracking-wide"
          style={{ color: "var(--accent-light)", border: "1px solid var(--border)" }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full animate-pulse"
            style={{ background: "var(--accent-light)" }}
          />
          Local-first · pdf.js · Ollama · Privacy-first
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h1
        className="mx-auto max-w-4xl text-5xl font-bold leading-tight tracking-tight sm:text-6xl md:text-7xl"
        {...fadeUp(0.2)}
      >
        Understand Documents.{" "}
        <span className="text-gradient">Offline.</span>
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        className="mt-6 max-w-2xl text-lg leading-relaxed sm:text-xl"
        style={{ color: "var(--text-secondary)" }}
        {...fadeUp(0.3)}
      >
        Kiosk‑Scholar runs a local LLM directly on your machine — no cloud,
        no subscriptions, no data ever leaving your device. Upload a PDF and
        get traceable AI insights in seconds.
      </motion.p>

      {/* CTAs */}
      <motion.div className="mt-10 flex flex-wrap items-center justify-center gap-4" {...fadeUp(0.4)}>
        <a
          href="https://github.com/Syrthax/Kiosk-Scholar/releases/tag/0.0.1"
          target="_blank"
          rel="noreferrer"
          className="group inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-lg"
          style={{
            background: "linear-gradient(135deg, var(--accent) 0%, #9333ea 100%)",
            boxShadow: "0 0 0 1px rgba(139,92,246,0.3), 0 8px 24px var(--glow)",
          }}
        >
          Download Kiosk-Scholar
          <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
        </a>
        <a
          href="https://github.com/Syrthax/Kiosk-Scholar"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium transition-all duration-200 hover:scale-[1.02]"
          style={{
            background: "var(--surface)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
          }}
        >
          <Play size={13} style={{ color: "var(--accent-light)" }} />
          View on GitHub
        </a>
      </motion.div>

      {/* Product mock */}
      <motion.div
        className="relative mt-20 w-full max-w-5xl"
        initial={{ opacity: 0, y: 48, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.9, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Glow behind mockup */}
        <div
          className="pointer-events-none absolute inset-x-12 -bottom-4 h-24 blur-2xl opacity-30 rounded-full"
          style={{ background: "var(--accent)" }}
        />

        <div
          className="relative overflow-hidden rounded-2xl"
          style={{
            border: "1px solid var(--border)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.35), 0 0 0 1px var(--border)",
            background: "var(--surface)",
          }}
        >
          {/* Window chrome */}
          <div
            className="flex items-center gap-2 px-5 py-3.5"
            style={{ borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}
          >
            <span className="h-3 w-3 rounded-full bg-red-400/80" />
            <span className="h-3 w-3 rounded-full bg-yellow-400/80" />
            <span className="h-3 w-3 rounded-full bg-green-400/80" />
            <div className="ml-4 flex items-center gap-2">
              <img src={logo} alt="Kiosk-Scholar" className="h-5 w-5 rounded object-cover" />
              <span
                className="text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Kiosk-Scholar — AI PDF Reader
              </span>
            </div>
          </div>

          {/* App layout mock */}
          <div className="flex h-96 text-left">
            {/* Sidebar */}
            <div
              className="hidden w-48 flex-shrink-0 sm:flex flex-col gap-1 p-4"
              style={{ borderRight: "1px solid var(--border)" }}
            >
              {["Library", "Analysis", "Recent"].map((item, i) => (
                <div
                  key={item}
                  className="rounded-lg px-3 py-2 text-xs font-medium"
                  style={{
                    background: i === 1 ? "var(--surface2)" : "transparent",
                    color: i === 1 ? "var(--accent-light)" : "var(--text-muted)",
                  }}
                >
                  {item}
                </div>
              ))}
              <div className="mt-4 h-px" style={{ background: "var(--border)" }} />
              <p className="px-3 pt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Recent PDFs
              </p>
              {["attention_is_all.pdf", "llama3_paper.pdf", "rag_survey.pdf"].map((f) => (
                <div key={f} className="rounded-lg px-3 py-1.5 text-xs truncate" style={{ color: "var(--text-muted)" }}>
                  {f}
                </div>
              ))}
            </div>

            {/* PDF viewer area */}
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex items-center justify-center relative overflow-hidden p-6">
                {/* Fake PDF lines */}
                <div className="w-full max-w-sm space-y-3">
                  {[100, 85, 92, 78, 95, 60, 88].map((w, i) => (
                    <div
                      key={i}
                      className="h-2 rounded-full"
                      style={{
                        width: `${w}%`,
                        background: i === 2 || i === 5
                          ? "linear-gradient(90deg, var(--accent) 0%, var(--accent-light) 100%)"
                          : "var(--surface2)",
                        opacity: i === 2 || i === 5 ? 0.9 : 0.5,
                      }}
                    />
                  ))}
                  {/* Highlight callout */}
                  <div
                    className="mt-4 rounded-xl p-3 text-xs"
                    style={{
                      background: "linear-gradient(135deg, rgba(124,58,237,0.12), rgba(167,139,250,0.06))",
                      border: "1px solid var(--border)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <p className="font-semibold mb-1" style={{ color: "var(--accent-light)" }}>
                      AI Summary · Page 3
                    </p>
                    <p>
                      The attention mechanism allows the model to weigh the importance of different
                      tokens dynamically, enabling parallel computation...
                    </p>
                    <div className="mt-2 flex items-center gap-1" style={{ color: "var(--accent-light)" }}>
                      <span className="text-[11px]">↗ Jump to source</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI panel */}
            <div
              className="hidden lg:flex w-64 flex-col p-4 gap-3"
              style={{ borderLeft: "1px solid var(--border)" }}
            >
              <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                AI Analysis
              </p>
              {[
                { label: "Key concept", value: "Self-attention" },
                { label: "Pages analyzed", value: "12 / 12" },
                { label: "Model", value: "llama3.2" },
                { label: "Mode", value: "Offline ✓" },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg p-2.5" style={{ background: "var(--surface2)" }}>
                  <p className="text-[10px] mb-0.5" style={{ color: "var(--text-muted)" }}>{label}</p>
                  <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {value}
                  </p>
                </div>
              ))}
              <div
                className="mt-auto rounded-xl p-3 text-xs"
                style={{ background: "linear-gradient(135deg,rgba(124,58,237,0.14),rgba(99,102,241,0.08))", border: "1px solid var(--border)" }}
              >
                <p style={{ color: "var(--text-secondary)" }}>
                  "What is the role of positional encoding?"
                </p>
                <p className="mt-1.5" style={{ color: "var(--text-muted)" }}>
                  Answer ↗
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
