import { useEffect, useRef, useState } from "react";
import { Avatar } from "@heroui/react";
import type { Message, ReviewRow, Sender } from "../types";
import { MoveBadge } from "./MoveBadge";

interface Props {
  contact: string;
  unread: number;
  messages: Message[];
  review?: ReviewRow[] | null;
  activeIndex?: number | null;
  onContactChange: (name: string) => void;
  onSend: (text: string, sender: Sender) => void;
}

export function ChatPane({
  contact,
  unread,
  messages,
  review,
  activeIndex,
  onContactChange,
  onSend,
}: Props) {
  const [draft, setDraft] = useState("");
  // Default: a typed message is from the OTHER person (you read their texts and
  // the engine computes your reply). Toggle to send as yourself instead.
  const [sender, setSender] = useState<Sender>("them");
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (activeIndex != null)
      activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onSend(t, sender);
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* contact header */}
      <div className="relative flex h-[62px] items-center justify-between border-b border-default-200 px-4">
        {/* back + unread badge */}
        <div className="flex items-center gap-1 text-[#0a84ff]">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.8" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="min-w-[20px] rounded-full bg-[#0a84ff] px-1.5 text-center text-[12px] font-semibold leading-5 text-white">
            {unread}
          </span>
        </div>
        {/* centered contact — absolutely centered on both axes so nothing clips */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
          <Avatar
            size="sm"
            name={contact}
            className="mb-0.5 h-7 w-7 text-[11px]"
            classNames={{ base: "bg-default-200" }}
          />
          <div className="pointer-events-auto flex items-center gap-0.5 whitespace-nowrap text-[12px] font-medium text-default-700">
            <input
              value={contact}
              onChange={(e) => onContactChange(e.target.value)}
              aria-label="Contact name"
              spellCheck={false}
              style={{ width: `${Math.max(contact.length, 4)}ch` }}
              className="bg-transparent text-center text-[12px] font-medium text-default-700 outline-none focus:text-[#0a84ff]"
            />
            <svg width="9" height="9" viewBox="0 0 24 24" className="text-default-400">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" fill="none"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        {/* video call icon */}
        <svg width="22" height="22" viewBox="0 0 24 24" className="text-[#0a84ff]">
          <rect x="2.5" y="6.5" width="12" height="11" rx="2.5" stroke="currentColor"
            strokeWidth="1.8" fill="none" />
          <path d="M15 10l5-3v10l-5-3" stroke="currentColor" strokeWidth="1.8" fill="none"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-1.5">
          {messages.map((m, i) => {
            const mine = m.sender === "me";
            const prev = messages[i - 1];
            const grouped = prev && prev.sender === m.sender;
            const rev = review?.[i];
            const cls = rev?.classification;
            const active = activeIndex === i;
            return (
              <div
                key={m.id}
                ref={active ? activeRef : undefined}
                className={`flex items-end gap-1.5 ${mine ? "justify-end" : "justify-start"} ${
                  grouped ? "" : "mt-1.5"
                }`}
              >
                {mine && cls && <MoveBadge c={cls} size={18} />}
                <div
                  className={`max-w-[74%] rounded-[18px] px-3.5 py-2 text-[14.5px] leading-snug transition ${
                    mine ? "bg-[#0a84ff] text-white" : "bg-[#e9e9eb] text-black"
                  } ${active ? "ring-2 ring-offset-1" : ""}`}
                  style={active && cls ? { boxShadow: `0 0 0 2px ${cls.color}` } : undefined}
                >
                  {m.text}
                </div>
                {!mine && cls && <MoveBadge c={cls} size={18} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* input bar */}
      <div className="flex items-center gap-2 border-t border-default-200 px-3 py-2.5">
        {/* sender toggle: who is this typed message from */}
        <div className="flex shrink-0 rounded-full bg-default-100 p-0.5 text-[11px] font-medium">
          {(["them", "me"] as Sender[]).map((s) => (
            <button
              key={s}
              onClick={() => setSender(s)}
              className={`rounded-full px-2 py-0.5 transition ${
                sender === s
                  ? s === "me"
                    ? "bg-[#0a84ff] text-white"
                    : "bg-white text-default-700 shadow-sm"
                  : "text-default-400"
              }`}
            >
              {s === "them" ? contact.trim().split(" ")[0] || "Them" : "Me"}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={sender === "me" ? "iMessage" : `Message from ${contact.trim() || "them"}`}
            className="w-full rounded-full border border-default-300 bg-white py-1.5 pl-3.5 pr-9 text-[14px] outline-none focus:border-default-400"
          />
          {draft.trim() ? (
            <button
              onClick={submit}
              className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[#0a84ff] text-white"
              aria-label="Send"
            >
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="2.5"
                  fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <svg
              width="16" height="16" viewBox="0 0 24 24"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-default-400"
            >
              <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor"
                strokeWidth="1.8" fill="none" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8"
                fill="none" strokeLinecap="round" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
