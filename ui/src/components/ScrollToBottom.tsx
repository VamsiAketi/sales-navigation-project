import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

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

function getScrollPos(target: ReturnType<typeof resolveScrollTarget>) {
  if (target.type === "element") {
    const el = target.element;
    return {
      fromTop: el.scrollTop,
      fromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
    };
  }
  const scroller = document.scrollingElement ?? document.documentElement;
  return {
    fromTop: window.scrollY,
    fromBottom: scroller.scrollHeight - window.scrollY - window.innerHeight,
  };
}

/**
 * Pair of ↑ / ↓ scroll buttons centred in the gap between the max-w-2xl
 * content column and the right-side properties panel.
 *
 * @param rightOffset  Width of the right panel in px (0 when panel is hidden).
 */
export function ScrollToBottom({ rightOffset = 0 }: { rightOffset?: number }) {
  const [showDown, setShowDown] = useState(false);
  const [showUp, setShowUp] = useState(false);
  /** CSS `right` value in px, computed to centre buttons in the gap. */
  const [rightPx, setRightPx] = useState(rightOffset + 24);

  // Recompute gap-centre whenever the panel opens/closes or viewport resizes.
  useEffect(() => {
    const measure = () => {
      const mainContent = document.getElementById("main-content");
      if (!mainContent) { setRightPx(rightOffset + 24); return; }

      const mainRect = mainContent.getBoundingClientRect();
      const W = window.innerWidth;
      const P = rightOffset;

      // Right edge of the max-w-2xl content (max 672 px) plus p-6 (24 px) padding.
      const contentWidth = Math.min(672, mainRect.width - 48);
      const contentRightFromLeft = mainRect.left + 24 + contentWidth;

      // Left edge of the panel (= where main-content ends) from viewport left.
      const panelLeftFromLeft = W - P;

      if (panelLeftFromLeft > contentRightFromLeft + 32) {
        // Enough gap — centre the buttons inside it.
        const gapCenterFromLeft = (contentRightFromLeft + panelLeftFromLeft) / 2;
        setRightPx(Math.round(W - gapCenterFromLeft));
      } else {
        // Tight / no gap — hug the panel edge.
        setRightPx(P + 16);
      }
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [rightOffset]);

  // Track scroll position to decide which buttons are visible.
  useEffect(() => {
    const check = () => {
      const { fromTop, fromBottom } = getScrollPos(resolveScrollTarget());
      setShowDown(fromBottom > 200);
      setShowUp(fromTop > 200);
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

  const scrollToTop = useCallback(() => {
    const target = resolveScrollTarget();
    if (target.type === "element") {
      target.element.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const target = resolveScrollTarget();
    if (target.type === "element") {
      target.element.scrollTo({ top: target.element.scrollHeight, behavior: "smooth" });
    } else {
      const scroller = document.scrollingElement ?? document.documentElement;
      window.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    }
  }, []);

  if (!showUp && !showDown) return null;

  const btnClass =
    "flex h-9 w-9 items-center justify-center rounded-full border-2 border-border bg-background text-foreground shadow-lg hover:bg-accent hover:border-foreground/30 transition-colors";

  return (
    <div
      className="fixed bottom-[calc(1.5rem+5rem+env(safe-area-inset-bottom))] z-40 flex flex-col gap-2 md:bottom-8 -translate-x-1/2"
      style={{ right: `${rightPx}px`, transform: "translateX(50%)" }}
    >
      {showUp && (
        <button onClick={scrollToTop} className={btnClass} aria-label="Scroll to top">
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
      {showDown && (
        <button onClick={scrollToBottom} className={btnClass} aria-label="Scroll to bottom">
          <ArrowDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
