import { SalesNavigation } from "./pages/SalesNavigation";

export function SalesNavOnlyApp() {
  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#f4f4f5] text-[#111827]">
      <aside className="hidden w-72 shrink-0 border-r border-[#d1d5db] bg-[#f2f1ed] md:flex md:flex-col">
        <div className="p-3">
          <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
            Navigation
          </div>
          <div className="flex items-center gap-2 rounded-md bg-[#eef2ff] px-3 py-2 text-sm font-medium text-[#1f2937]">
            <span className="inline-block h-4 w-1 rounded-full bg-[#111827]" />
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#ef4444]" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
            </svg>
            Sales Navigation
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between border-t border-[#d1d5db] px-3 py-3 text-[#374151]">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none text-[#6b7280]">«</span>
            <span className="text-base leading-none text-[#f97316]">◧</span>
            <a
              href="https://ai-harness.com/"
              target="_blank"
              rel="noreferrer"
              className="text-base font-semibold leading-none text-[#1f3a5f] hover:underline"
            >
              AI-Harness.com
            </a>
          </div>
          <div className="flex items-center gap-3 text-lg">
            <span title="Theme">◔</span>
            <span title="Info">ⓘ</span>
          </div>
        </div>
      </aside>
      <section className="min-w-0 flex-1 overflow-hidden bg-[#f9fafb]">
        <SalesNavigation />
      </section>
    </main>
  );
}
