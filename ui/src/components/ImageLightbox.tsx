import { useCallback, useEffect, useRef, useState } from "react";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";

const ZOOM_STEP = 0.25;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 4;

export interface ImageLightboxState {
  src: string;
  alt: string;
  /** When set, toolbar shows a download control (e.g. `?download=1` on issue attachment URLs). */
  downloadHref?: string;
}

export function ImageLightbox({
  src,
  alt,
  downloadHref,
  onClose,
}: ImageLightboxState & { onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const backdropRef = useRef<HTMLDivElement>(null);
  const imageWrapRef = useRef<HTMLDivElement>(null);

  const zoomIn  = useCallback(() => setZoom((z) => Math.min(+(z + ZOOM_STEP).toFixed(2), ZOOM_MAX)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(+(z - ZOOM_STEP).toFixed(2), ZOOM_MIN)), []);

  /* Close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  /* Scroll-wheel zoom on the image area */
  useEffect(() => {
    const el = imageWrapRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) =>
        Math.min(Math.max(+(z - e.deltaY * 0.001).toFixed(2), ZOOM_MIN), ZOOM_MAX)
      );
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  return (
    /* Backdrop */
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      {/*
        ── Dialog window ───────────────────────────────────────────────────────
        Wide rectangular panel: up to 90vw × 90vh, never tiny
      */}
      <div
        className="relative flex flex-col overflow-hidden rounded-sm border border-white/10 bg-[#1a1a1f] shadow-2xl"
        style={{ width: "min(90vw, 1100px)", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Title bar ────────────────────────────────────────────────────── */}
        <div className="flex w-full shrink-0 items-center gap-2 border-b border-white/10 bg-[#222228] px-4 py-2">
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              title="Zoom out"
              className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 transition-colors"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>

            <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-white/50 select-none">
              {Math.round(zoom * 100)}%
            </span>

            <button
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              title="Zoom in"
              className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 transition-colors"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex min-w-0 flex-1 justify-center px-2">
            {alt ? (
              <span className="max-w-full truncate text-xs text-white/40 select-none">{alt}</span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {downloadHref ? (
              <a
                href={downloadHref}
                download
                rel="noreferrer"
                title="Download"
                className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <button
              onClick={onClose}
              title="Close (Esc)"
              className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* ── Image area ───────────────────────────────────────────────────── */}
        <div
          ref={imageWrapRef}
          className="flex flex-1 cursor-zoom-in items-center justify-center overflow-auto p-8"
          style={{ minHeight: "300px" }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "center center",
              transition: "transform 0.12s ease",
              maxWidth: "100%",
            }}
            className="rounded shadow-xl select-none"
          />
        </div>
      </div>
    </div>
  );
}
