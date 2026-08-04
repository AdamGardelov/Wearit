import { useEffect, useState } from "react";
import { ArrowUp } from "@phosphor-icons/react";

export function ScrollToTopButton({ active = true, raised = false, onActivate = null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return undefined;
    }
    const updateVisibility = () => {
      const threshold = Math.max(420, window.innerHeight * 0.65);
      setVisible(window.scrollY > threshold);
    };
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);
    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [active]);

  const scrollToTop = () => {
    if (onActivate) {
      onActivate();
      return;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      className={`scroll-top-button${raised ? " scroll-top-button--raised" : ""}`}
      onClick={scrollToTop}
      aria-label="Scrolla till toppen"
    >
      <ArrowUp size={18} weight="bold" aria-hidden="true" />
      <span>Upp</span>
    </button>
  );
}
