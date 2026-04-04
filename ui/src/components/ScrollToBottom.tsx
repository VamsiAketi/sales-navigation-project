import { useCallback, useEffect, useState } from "react";
import { ArrowDown } from "lucide-react";

function resolveScrollTarget() {
  const mainContent = document.getElementById("main-content");

  if (mainContent instanceof HTMLElement) {
    const overflowY = window.getComputedStyle(mainContent).overflowY;
    const usesOwnScroll =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
      && mainContent.scrollHeight > mainContent.clientHeight + 1;

    if (usesOwnScroll) {
      return { type: "element" as const, element: mainContent };
    }
  }

  return { type: "window" as const };
}

function distanceFromBottom(target: ReturnType<typeof resolveScrollTarget>) {
  if (target.type === "element") {
    return target.element.scrollHeight - target.element.scrollTop - target.element.clientHeight;
  }

  const scroller = document.scrollingElement ?? document.documentElement;
  return scroller.scrollHeight - window.scrollY - window.innerHeight;
}

/**
 * Floating scroll-to-bottom button that follows the active page scroller.
 * On desktop that is `#main-content`; on mobile it falls back to window/page scroll.
 *
 * @param rightOffset - Extra pixels to add to the right offset (e.g. 320 for a 320px side panel).
 */
export function ScrollToBottom({ rightOffset = 0 }: { rightOffset?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const check = () => {
      setVisible(distanceFromBottom(resolveScrollTarget()) > 300);
    };

    const mainContent = document.getElementById("main-content");

    check();
    mainContent?.addEventListener("scroll", check, { passive: true });
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);

    return () => {
      mainContent?.removeEventListener("scroll", check);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  const scroll = useCallback(() => {
    const target = resolveScrollTarget();

    if (target.type === "element") {
      target.element.scrollTo({ top: target.element.scrollHeight, behavior: "smooth" });
      return;
    }

    const scroller = document.scrollingElement ?? document.documentElement;
    window.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={scroll}
      style={{ right: `calc(${rightOffset}px + 0.75rem)` }}
      className="fixed bottom-[calc(1.5rem+5rem+env(safe-area-inset-bottom))] z-40 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow-md hover:bg-accent transition-[right,background-color] duration-200 md:bottom-6"
      aria-label="Scroll to bottom"
    >
      <ArrowDown className="h-4 w-4" />
    </button>
  );
}
