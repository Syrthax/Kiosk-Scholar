import { motion } from "framer-motion";
import logo from "../assets/logo.jpeg";

export default function Footer() {
  return (
    <motion.footer
      className="px-6 pb-32 pt-16 text-center"
      style={{ borderTop: "1px solid var(--border)" }}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
    >
      <div className="mx-auto max-w-4xl flex flex-col items-center gap-6">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <img
            src={logo}
            alt="Kiosk-Scholar"
            className="h-8 w-8 rounded-lg object-cover"
            style={{ boxShadow: "0 0 0 1px var(--border)" }}
          />
          <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
            Kiosk-Scholar
          </span>
        </div>

        {/* Links */}
        <div className="flex flex-wrap items-center justify-center gap-6 text-sm" style={{ color: "var(--text-muted)" }}>
          <a
            href="https://github.com/Syrthax/Kiosk-Scholar"
            target="_blank"
            rel="noreferrer"
            className="hover:text-current transition-colors"
            style={{ color: "inherit" }}
          >
            GitHub
          </a>
          <a
            href="https://github.com/Syrthax/Kiosk-Scholar/releases/tag/0.0.1"
            target="_blank"
            rel="noreferrer"
            className="hover:text-current transition-colors"
            style={{ color: "inherit" }}
          >
            Download
          </a>
          <a
            href="https://github.com/Syrthax/Kiosk-Scholar/issues"
            target="_blank"
            rel="noreferrer"
            className="hover:text-current transition-colors"
            style={{ color: "inherit" }}
          >
            Issues
          </a>
        </div>

        {/* Divider */}
        <div className="h-px w-32" style={{ background: "var(--border)" }} />

        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Made with ❤️ by{" "}
          <span style={{ color: "var(--accent-light)" }}>Krisplabs</span>
          {" · "}
          Local-first. Privacy-first. Always.
        </p>
      </div>
    </motion.footer>
  );
}
