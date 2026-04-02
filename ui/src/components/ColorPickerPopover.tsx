/**
 * ColorPickerPopover
 * A fully custom color picker: saturation/brightness gradient square,
 * hue rainbow slider, and hex input. No native <input type="color">.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/* ── HSV ↔ Hex helpers ──────────────────────────────────────────────────── */

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const val = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(clamp(val, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

function hexToHsv(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return [0, 0, 0.5];
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, s, v];
}

function isValidHex(hex: string) {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

/* ── Drag helper ─────────────────────────────────────────────────────────── */

function useDrag(
  ref: React.RefObject<HTMLElement>,
  onMove: (x: number, y: number, rect: DOMRect) => void,
) {
  const dragging = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function start(e: PointerEvent) {
      dragging.current = true;
      el!.setPointerCapture(e.pointerId);
      const rect = el!.getBoundingClientRect();
      onMove(e.clientX, e.clientY, rect);
    }
    function move(e: PointerEvent) {
      if (!dragging.current) return;
      const rect = el!.getBoundingClientRect();
      onMove(e.clientX, e.clientY, rect);
    }
    function end() {
      dragging.current = false;
    }

    el.addEventListener("pointerdown", start);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return () => {
      el.removeEventListener("pointerdown", start);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
  }, [ref, onMove]);
}

/* ── ColorPickerPopover ──────────────────────────────────────────────────── */

export interface ColorPickerPopoverProps {
  value: string;           // hex e.g. "#7c3aed"
  onChange: (hex: string) => void;
  children: React.ReactNode; // the trigger element
}

export function ColorPickerPopover({ value, onChange, children }: ColorPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <div onClick={() => setOpen((v) => !v)} className="cursor-pointer">
        {children}
      </div>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 rounded-md border border-border bg-[#1e1e24] shadow-2xl"
          style={{ width: 220 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Picker value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

/* ── Internal picker ─────────────────────────────────────────────────────── */

function Picker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [h, s, v] = hexToHsv(isValidHex(value) ? value : "#6b7280");
  const [hue, setHue] = useState(h);
  const [sat, setSat] = useState(s);
  const [bri, setBri] = useState(v);
  const [hexInput, setHexInput] = useState(value);

  // Sync hex input when value changes externally
  useEffect(() => {
    setHexInput(value);
    const [nh, ns, nv] = hexToHsv(isValidHex(value) ? value : "#6b7280");
    setHue(nh);
    setSat(ns);
    setBri(nv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = useCallback(
    (nh: number, ns: number, nv: number) => {
      const hex = hsvToHex(nh, ns, nv);
      setHexInput(hex);
      onChange(hex);
    },
    [onChange],
  );

  /* Gradient square */
  const squareRef = useRef<HTMLDivElement>(null);
  const onSquareMove = useCallback(
    (cx: number, cy: number, rect: DOMRect) => {
      const ns = clamp((cx - rect.left) / rect.width, 0, 1);
      const nv = clamp(1 - (cy - rect.top) / rect.height, 0, 1);
      setSat(ns);
      setBri(nv);
      emit(hue, ns, nv);
    },
    [hue, emit],
  );
  useDrag(squareRef as React.RefObject<HTMLElement>, onSquareMove);

  /* Hue slider */
  const hueRef = useRef<HTMLDivElement>(null);
  const onHueMove = useCallback(
    (cx: number, _cy: number, rect: DOMRect) => {
      const nh = clamp(((cx - rect.left) / rect.width) * 360, 0, 360);
      setHue(nh);
      emit(nh, sat, bri);
    },
    [sat, bri, emit],
  );
  useDrag(hueRef as React.RefObject<HTMLElement>, onHueMove);

  const hueColor = hsvToHex(hue, 1, 1);
  const thumbX = `${(sat * 100).toFixed(1)}%`;
  const thumbY = `${((1 - bri) * 100).toFixed(1)}%`;

  return (
    <div className="p-3 space-y-3 select-none">
      {/* Saturation / brightness square */}
      <div
        ref={squareRef}
        className="relative w-full rounded-sm cursor-crosshair touch-none"
        style={{ height: 160, background: hueColor }}
      >
        {/* white → transparent (left→right = sat) */}
        <div
          className="absolute inset-0 rounded-sm"
          style={{ background: "linear-gradient(to right, #fff, transparent)" }}
        />
        {/* transparent → black (top→bottom = inverted brightness) */}
        <div
          className="absolute inset-0 rounded-sm"
          style={{ background: "linear-gradient(to bottom, transparent, #000)" }}
        />
        {/* Thumb */}
        <div
          className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md pointer-events-none"
          style={{ left: thumbX, top: thumbY, backgroundColor: hsvToHex(hue, sat, bri) }}
        />
      </div>

      {/* Hue slider */}
      <div
        ref={hueRef}
        className="relative h-3 w-full rounded-full cursor-pointer touch-none"
        style={{
          background:
            "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
        }}
      >
        {/* Thumb */}
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md pointer-events-none"
          style={{ left: `${(hue / 360) * 100}%`, backgroundColor: hueColor }}
        />
      </div>

      {/* Hex input row */}
      <div className="flex items-center gap-2">
        {/* Preview swatch */}
        <div
          className="h-7 w-7 shrink-0 rounded border border-white/20"
          style={{ backgroundColor: hsvToHex(hue, sat, bri) }}
        />
        <input
          value={hexInput}
          onChange={(e) => {
            const raw = e.target.value;
            setHexInput(raw);
            if (isValidHex(raw)) {
              const [nh, ns, nv] = hexToHsv(raw);
              setHue(nh);
              setSat(ns);
              setBri(nv);
              onChange(raw);
            }
          }}
          className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="#000000"
          maxLength={7}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
