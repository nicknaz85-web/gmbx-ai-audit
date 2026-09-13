"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types";
import { cn } from "@/lib/cn";

const OPEN_EVENT = "parallax:open-ai";
export function openAIPanel() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Inline text trigger to open the AI panel (usable inside server-rendered content). */
export function AskAILink({ label = "Ask a question →", className }: { label?: string; className?: string }) {
  return (
    <button onClick={openAIPanel} className={className ?? "text-[11px] text-accent hover:underline"}>
      {label}
    </button>
  );
}

/* Right-side slide-out AI research assistant. It is stock-aware (ticker + name
   passed in) and posts to /api/ai/chat, which grounds responses in the same
   structured data shown on the page. Understated styling — no chat bubbles. */
export function AIPanel({
  ticker,
  name,
  suggestions,
}: {
  ticker: string;
  name: string;
  suggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker, message: q, history }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: data.content, citations: data.citations }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Something went wrong reaching the analysis service. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Floating trigger — phone only; the header's Ask AI button scrolls away.
          Sits above the bottom nav. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-[70px] right-4 z-40 flex h-11 items-center gap-1.5 rounded-full border border-line-2 bg-surface-3 pl-3.5 pr-4 text-[13px] font-medium text-text shadow-xl md:hidden"
          aria-label={`Ask AI about ${ticker}`}
        >
          <span className="text-[11px] font-bold text-accent">AI</span>
          Ask
        </button>
      )}

      {/* Backdrop */}
      <div
        className={cn("fixed inset-0 z-50 bg-black/50 transition-opacity duration-200", open ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => setOpen(false)}
      />
      {/* Panel */}
      <aside
        className="fixed right-0 top-0 z-[60] flex h-full w-full max-w-[460px] flex-col border-l border-line-2 bg-surface transition-transform duration-200 ease-out"
        style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-5 items-center rounded bg-accent/15 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent">AI</span>
              <h2 className="text-[14px] font-semibold">Ask about {ticker}</h2>
            </div>
            <p className="mt-0.5 text-[11px] text-faint">Grounded in {name}&apos;s financials, earnings &amp; news</p>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} className="btn btn-ghost !h-7 !px-2 text-[11px] text-muted">Clear</button>
            )}
            <button onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text" aria-label="Close">✕</button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-[13px] leading-relaxed text-muted">
                I&apos;m a financial research assistant analysing <span className="font-medium text-text">{name} ({ticker})</span>. Ask about valuation, earnings, the bull/bear case, risks or what could move the stock. I answer only from the data on this page and flag interpretation clearly.
              </p>
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Suggested</div>
                {suggestions.map((s) => (
                  <button key={s} onClick={() => send(s)} className="flex w-full items-center justify-between rounded-md border border-line bg-surface-2 px-3 py-2 text-left text-[13px] text-muted transition-colors hover:border-line-2 hover:text-text">
                    {s}<span className="text-faint">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={cn(m.role === "user" ? "flex justify-end" : "")}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-lg rounded-br-sm border border-line-2 bg-surface-2 px-3 py-2 text-[13px]">{m.content}</div>
              ) : (
                <div className="max-w-full">
                  <div className="prose-ai text-[13px] leading-relaxed text-text">
                    <Markdownish text={m.content} />
                  </div>
                  {m.citations && m.citations.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.citations.map((c) => (
                        <span key={c} className="inline-flex h-[17px] items-center rounded border border-line-2 bg-surface-2 px-1.5 text-[10px] font-medium text-muted">{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-1.5 text-[12px] text-faint">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              Analysing {ticker} data…
            </div>
          )}
        </div>

        <div className="border-t border-line p-3">
          <div className="flex items-end gap-2 rounded-lg border border-line-2 bg-bg-2 px-2.5 py-2 focus-within:border-accent/50">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
              }}
              rows={1}
              placeholder={`Ask about ${ticker}…`}
              className="max-h-28 flex-1 resize-none bg-transparent text-[13px] text-text placeholder:text-faint outline-none"
            />
            <button onClick={() => send(input)} disabled={busy || !input.trim()} className="btn btn-primary !h-8 !px-3 text-[12px] disabled:opacity-40">Send</button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-faint">Responses are AI-generated from available data and are not financial advice.</p>
        </div>
      </aside>
    </>
  );
}

/* Minimal markdown renderer: **bold**, bullet lists, and paragraphs. Kept tiny
   and dependency-free; the AI is prompted to emit this restricted subset. */
function Markdownish({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^\s*[-*]\s+/.test(l) || l.trim() === "");
        if (isList) {
          return (
            <ul key={bi} className="my-1.5 space-y-1">
              {lines.filter((l) => l.trim()).map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-faint" />
                  <span>{inline(l.replace(/^\s*[-*]\s+/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={bi} className="my-1.5">{inline(block)}</p>;
      })}
    </>
  );
}

function inline(s: string): React.ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold text-text">{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>
  );
}
