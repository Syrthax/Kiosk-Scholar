import { motion } from "framer-motion";
import { WifiOff, Lock, GitBranch } from "lucide-react";

const pillars = [
  {
    icon: WifiOff,
    title: "No internet required",
    desc: "Works fully air-gapped. Install Ollama, pull a model, and the product runs indefinitely — no connectivity needed.",
    gradient: "from-purple-600/20 to-indigo-600/10",
  },
  {
    icon: Lock,
    title: "Zero data leakage",
    desc: "Documents, queries, and answers never touch a remote server. Inference happens entirely on your CPU or GPU.",
    gradient: "from-violet-600/20 to-purple-600/10",
  },
  {
    icon: GitBranch,
    title: "Fully traceable AI",
    desc: "Every AI response links back to a specific page and passage in the source document. No hallucination without accountability.",
    gradient: "from-indigo-600/20 to-blue-600/10",
  },
];

export default function WhyKiosk() {
  return (
    <section className="px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <motion.div
          className="mb-16 text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <p className="mb-3 text-sm font-medium tracking-widest uppercase" style={{ color: "var(--accent-light)" }}>
            The difference
          </p>
          <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Why{" "}
            <span className="text-gradient">Kiosk-Scholar?</span>
          </h2>
          <p className="mt-4 max-w-xl mx-auto text-lg" style={{ color: "var(--text-secondary)" }}>
            Most AI tools send your documents to remote servers. Kiosk-Scholar keeps
            intelligence where it belongs — on your machine.
          </p>
        </motion.div>

        {/* Pillars */}
        <div className="grid gap-6 md:grid-cols-3">
          {pillars.map(({ icon: Icon, title, desc, gradient }, i) => (
            <motion.div
              key={title}
              className="card-hover relative overflow-hidden rounded-3xl p-8"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
            >
              {/* Background gradient */}
              <div
                className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${gradient} rounded-3xl`}
              />

              <div className="relative z-10">
                <div
                  className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl"
                  style={{
                    background: "linear-gradient(135deg,rgba(124,58,237,0.2),rgba(99,102,241,0.1))",
                    border: "1px solid var(--border)",
                  }}
                >
                  <Icon size={22} style={{ color: "var(--accent-light)" }} />
                </div>

                <h3 className="mb-3 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Comparison strip */}
        <motion.div
          className="mt-12 overflow-hidden rounded-2xl"
          style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <div className="grid grid-cols-3">
            {["", "Kiosk-Scholar", "Cloud AI tools"].map((h, i) => (
              <div
                key={i}
                className="px-5 py-3 text-xs font-semibold"
                style={{
                  background: i === 1 ? "rgba(124,58,237,0.1)" : i === 0 ? "transparent" : "var(--surface2)",
                  color: i === 1 ? "var(--accent-light)" : "var(--text-muted)",
                  textAlign: i === 0 ? "left" : "center",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {h}
              </div>
            ))}
            {[
              ["Works offline", true, false],
              ["Data stays local", true, false],
              ["Source traceability", true, "Partial"],
              ["Free & open source", true, false],
              ["No subscription", true, false],
            ].map(([label, ks, cloud]) => (
              <>
                {[label, ks, cloud].map((val, ci) => (
                  <div
                    key={`${label}-${ci}`}
                    className="px-5 py-3 text-xs"
                    style={{
                      background: ci === 1 ? "rgba(124,58,237,0.05)" : "transparent",
                      color:
                        ci === 0
                          ? "var(--text-secondary)"
                          : val === true
                          ? "#4ade80"
                          : val === false
                          ? "#f87171"
                          : "var(--text-muted)",
                      textAlign: ci === 0 ? "left" : "center",
                      borderBottom: "1px solid var(--border)",
                      fontWeight: ci === 0 ? 400 : 600,
                    }}
                  >
                    {val === true ? "✓ Yes" : val === false ? "✗ No" : val}
                  </div>
                ))}
              </>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
