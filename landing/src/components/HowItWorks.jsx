import { motion } from "framer-motion";
import { Upload, Cpu, MousePointerClick, MessagesSquare } from "lucide-react";

const steps = [
  {
    icon: Upload,
    step: "01",
    title: "Upload a PDF",
    desc: "Drag & drop any academic paper, report, or document. Kiosk-Scholar handles the rest.",
  },
  {
    icon: Cpu,
    step: "02",
    title: "AI analyzes locally",
    desc: "Your local Ollama instance extracts, chunks, and understands the content — no cloud call ever made.",
  },
  {
    icon: MousePointerClick,
    step: "03",
    title: "Get traceable insights",
    desc: "Summaries, key concepts, and answers all link directly back to the source page in your PDF.",
  },
  {
    icon: MessagesSquare,
    step: "04",
    title: "Interact with the document",
    desc: "Ask follow-up questions, dig deeper into specific sections, and explore the document your way.",
  },
];

export default function HowItWorks() {
  return (
    <section className="px-6 py-28" style={{ background: "var(--surface)" }}>
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <motion.div
          className="mb-16 text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <p className="mb-3 text-sm font-medium tracking-widest uppercase" style={{ color: "var(--accent-light)" }}>
            How it works
          </p>
          <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
            From PDF to insight{" "}
            <span className="text-gradient">in four steps</span>
          </h2>
        </motion.div>

        {/* Steps */}
        <div className="relative">
          {/* Vertical connector line — desktop */}
          <div
            className="absolute left-1/2 top-12 hidden h-[calc(100%-6rem)] w-px -translate-x-1/2 lg:block"
            style={{ background: "linear-gradient(to bottom, var(--border), transparent)" }}
          />

          <div className="flex flex-col gap-10 lg:gap-0">
            {steps.map(({ icon: Icon, step, title, desc }, i) => (
              <motion.div
                key={step}
                className={`flex flex-col lg:flex-row items-center gap-8 lg:gap-16 ${
                  i % 2 === 1 ? "lg:flex-row-reverse" : ""
                }`}
                initial={{ opacity: 0, x: i % 2 === 0 ? -32 : 32 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.65, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* Content */}
                <div className="flex-1 text-center lg:text-left">
                  <p
                    className="mb-1 text-xs font-mono font-semibold tracking-widest"
                    style={{ color: "var(--accent-light)" }}
                  >
                    STEP {step}
                  </p>
                  <h3 className="mb-3 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {title}
                  </h3>
                  <p className="text-base leading-relaxed max-w-sm mx-auto lg:mx-0" style={{ color: "var(--text-secondary)" }}>
                    {desc}
                  </p>
                </div>

                {/* Icon node */}
                <div className="relative flex-shrink-0 z-10">
                  <div
                    className="flex h-24 w-24 items-center justify-center rounded-2xl"
                    style={{
                      background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(99,102,241,0.06))",
                      border: "1px solid var(--border)",
                      boxShadow: "0 0 32px var(--glow)",
                    }}
                  >
                    <Icon size={36} style={{ color: "var(--accent-light)" }} />
                  </div>
                  {/* Connector dot */}
                  <div
                    className="absolute -bottom-2 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full hidden lg:block"
                    style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }}
                  />
                </div>

                {/* Spacer for opposite side */}
                <div className="hidden lg:block flex-1" />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
