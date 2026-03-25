import { useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from "framer-motion";
import { Download, Sun, Moon } from "lucide-react";

const MAGNIFICATION = 2.2;
const DISTANCE = 100;

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
  </svg>
);

export default function Dock({ dark, setDark }) {
  const dockRef = useRef(null);
  const mouseX = useMotionValue(Infinity);

  const items = [
    {
      icon: <Download size={20} />,
      label: "Download",
      href: "https://github.com/Syrthax/Kiosk-Scholar/releases/tag/0.0.1",
    },
    {
      icon: dark ? <Sun size={20} /> : <Moon size={20} />,
      label: dark ? "Light mode" : "Dark mode",
      onClick: () => setDark((d) => !d),
    },
    {
      icon: <GitHubIcon />,
      label: "GitHub",
      href: "https://github.com/Syrthax/Kiosk-Scholar",
    },
  ];

  return (
    <motion.div
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, delay: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Pill outer container */}
      <motion.div
        ref={dockRef}
        className="flex items-center justify-center gap-2 px-4 py-2.5"
        style={{
          borderRadius: "9999px",
          background: dark
            ? "rgba(17, 13, 32, 0.8)"
            : "rgba(255, 255, 255, 0.72)",
          backdropFilter: "blur(28px) saturate(200%)",
          WebkitBackdropFilter: "blur(28px) saturate(200%)",
          border: "1px solid var(--border)",
          boxShadow: dark
            ? "0 8px 40px rgba(0,0,0,0.55), 0 0 0 1px var(--border), 0 0 28px var(--glow)"
            : "0 8px 32px rgba(0,0,0,0.1), 0 0 0 1px var(--border), 0 0 20px var(--glow)",
        }}
        onMouseMove={(e) => mouseX.set(e.pageX)}
        onMouseLeave={() => mouseX.set(Infinity)}
      >
        {items.map(({ icon, label, href, onClick }, i) => (
          <>
            {i === 2 && (
              <div key="sep" className="h-5 w-px mx-1" style={{ background: "var(--border)" }} />
            )}
            <DockItemMagnified
              key={label}
              mouseX={mouseX}
              label={label}
              href={href}
              onClick={onClick}
            >
              {icon}
            </DockItemMagnified>
          </>
        ))}

        {/* Divider + local indicator */}
        <div className="h-5 w-px mx-1" style={{ background: "var(--border)" }} />
        <div className="flex items-center gap-1.5 pl-1 pr-1">
          <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] font-medium tracking-wide" style={{ color: "var(--text-muted)" }}>
            local
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

const BASE = 40; // base circle diameter (px)

function DockItemMagnified({ mouseX, children, label, href, onClick }) {
  const ref = useRef(null);
  const [isHover, setIsHover] = useState(false);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const sizeTransform = useTransform(
    distance,
    [-DISTANCE, 0, DISTANCE],
    [BASE, BASE * MAGNIFICATION, BASE]
  );
  const size = useSpring(sizeTransform, { stiffness: 320, damping: 26, mass: 0.4 });
  const iconScale = useTransform(size, [BASE, BASE * MAGNIFICATION], [1, 1.35]);

  const inner = (
    <motion.div
      ref={ref}
      className="relative flex items-center justify-center"
      onHoverStart={() => setIsHover(true)}
      onHoverEnd={() => setIsHover(false)}
      whileTap={{ scale: 0.84 }}
      style={{ width: size, height: size }}
    >
      {/* Circular button */}
      <motion.div
        className="flex items-center justify-center"
        onClick={onClick}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: isHover
            ? "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(99,102,241,0.1))"
            : "rgba(255,255,255,0.07)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
          cursor: "pointer",
          boxShadow: isHover ? "0 0 16px var(--glow)" : "none",
          transition: "box-shadow 0.15s ease, background 0.15s ease",
        }}
      >
        <motion.span style={{ scale: iconScale, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {children}
        </motion.span>
      </motion.div>

      {/* Tooltip */}
      <AnimatePresence>
        {isHover && (
          <motion.div
            className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium pointer-events-none z-50"
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            }}
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.9 }}
            transition={{ duration: 0.12 }}
          >
            {label}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {inner}
    </a>
  ) : (
    inner
  );
}
