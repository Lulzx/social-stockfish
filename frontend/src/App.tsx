import { useEffect, useState } from "react";
import { ChatPane } from "./components/ChatPane";
import { EnginePane } from "./components/EnginePane";
import { EvalBar } from "./components/EvalBar";
import { PasteModal } from "./components/PasteModal";
import { UpgradeModal } from "./components/UpgradeModal";
import { useEngine } from "./useEngine";
import { fetchEntitlement, type Entitlement } from "./lib";
import type { Message, RankedResult, Sender } from "./types";

let _id = 0;
const mkId = () => `m${_id++}`;
const seed = (sender: Message["sender"], text: string): Message => ({ id: mkId(), sender, text });

// Demo: a high-stakes conversation — angling for a promotion with your manager.
const SEED_MESSAGES: Message[] = [
  seed("them", "thanks for sending over your self-review"),
  seed("me", "of course, happy to walk through any of it"),
  seed("them", "the team's been stretched thin on budget this quarter"),
  seed("me", "yeah it's been a grind for everyone"),
  seed("them", "what did you want to cover in our 1:1 today?"),
];

const SEED_GOAL = "get Priya to approve my promotion to senior";

export default function App() {
  const [messages, setMessages] = useState<Message[]>(SEED_MESSAGES);
  const [goal, setGoal] = useState(SEED_GOAL);
  const [contact, setContact] = useState("Priya");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [activeMove, setActiveMove] = useState<number | null>(null);
  const [tab, setTab] = useState<"chat" | "engine">("chat");
  const [saveHistory, setSaveHistory] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [ent, setEnt] = useState<Entitlement>({
    pro: false, reviewsUsed: 0, freeReviews: 2, billingEnabled: false,
  });
  const { state: engine, analyze, review, loadReview, reset } = useEngine();

  // Entitlement (free-tier / Pro) by anonymous device id; refetch after Stripe return.
  useEffect(() => {
    fetchEntitlement().then(setEnt);
    if (new URLSearchParams(location.search).get("pro") === "1") {
      window.history.replaceState({}, "", location.pathname);
    }
  }, []);

  // A free-limit hit opens the upgrade modal.
  useEffect(() => {
    if (engine.paywall) setUpgradeOpen(true);
  }, [engine.paywall]);

  // If opened with ?review=<id>, load that shared game review.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("review");
    if (!id) return;
    fetch(`/review/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setMessages(d.messages.map((m: { sender: Sender; text: string }) => seed(m.sender, m.text)));
        setContact(d.contact || "Them");
        setGoal(d.goal || "");
        loadReview(d.rows, d.finalEval, d.id);
        setTab("engine");
      })
      .catch(() => {});
  }, [loadReview]);

  // Analysis runs only on demand (Analyze / Game Review buttons), never automatically.
  const send = (text: string, sender: Sender) =>
    setMessages((m) => [...m, seed(sender, text)]);
  // Picking a suggested move adds it as *your* sent message.
  const pick = (r: RankedResult) => setMessages((m) => [...m, seed("me", r.text)]);

  const newChat = () => {
    setMessages([]);
    setActiveMove(null);
    reset();
    setTab("chat");
    if (location.search) window.history.replaceState({}, "", location.pathname);
  };

  const loadPasted = (msgs: Message[], them: string) => {
    setMessages(msgs);
    setContact(them);
    setActiveMove(null);
    setTab("chat");
  };

  // On mobile, jump to the engine tab whenever analysis/review starts.
  const runAnalyze = () => {
    setTab("engine");
    analyze(messages, goal, contact, saveHistory);
  };
  const runReview = () => {
    setTab("engine");
    review(messages, goal, contact, saveHistory);
  };

  // Explicit share = consent to persist this review; returns a shareable link.
  const shareReview = async (): Promise<string | null> => {
    if (!engine.review) return null;
    try {
      const r = await fetch("/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          contact,
          finalEval: engine.finalEval,
          rows: engine.review,
          messages: messages.map((m) => ({ sender: m.sender, text: m.text })),
        }),
      });
      const d = await r.json();
      return d.id ? `${location.origin}/?review=${d.id}` : null;
    } catch {
      return null;
    }
  };

  // The Stockfish-style eval bar shows the current position eval (how you're
  // actually doing); falls back to the best move's score before a position read.
  const evalScore =
    engine.mode === "review" && engine.finalEval !== null
      ? engine.finalEval
      : engine.positionEval ?? (engine.ranked.length ? engine.ranked[0].score : null);

  const reviewing = engine.mode === "review" && !!engine.review;

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-white md:flex-row">
      {/* desktop: vertical eval bar on the far left */}
      <EvalBar score={evalScore} className="hidden md:block" />

      {/* mobile: horizontal eval bar + tab switcher */}
      <div className="md:hidden">
        <EvalBar score={evalScore} orientation="horizontal" />
        <div className="flex border-b border-default-200 bg-white text-[13px] font-semibold">
          {(["chat", "engine"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 transition ${
                tab === t
                  ? "border-b-2 border-[#0a84ff] text-[#0a84ff]"
                  : "text-default-400"
              }`}
            >
              {t === "chat" ? contact || "Chat" : "Social Stockfish"}
            </button>
          ))}
        </div>
      </div>

      {/* chat pane */}
      <div
        className={`${tab === "chat" ? "flex" : "hidden"} min-h-0 w-full flex-1 md:flex md:w-1/2 md:min-w-[320px] md:flex-none md:border-r md:border-default-200`}
      >
        <ChatPane
          contact={contact}
          unread={5}
          messages={messages}
          review={reviewing ? engine.review : null}
          activeIndex={reviewing ? activeMove : null}
          onContactChange={setContact}
          onSend={send}
          onNewChat={newChat}
        />
      </div>

      {/* engine pane */}
      <div className={`${tab === "engine" ? "flex" : "hidden"} min-h-0 w-full flex-1 md:flex md:min-w-0`}>
        <EnginePane
          engine={engine}
          goal={goal}
          messages={messages}
          pro={ent.pro}
          saveHistory={saveHistory}
          onToggleSaveHistory={setSaveHistory}
          onGoalChange={setGoal}
          onPick={pick}
          onAnalyze={runAnalyze}
          onReview={runReview}
          onPaste={() => setPasteOpen(true)}
          onActiveMove={setActiveMove}
          onShareLink={shareReview}
          onUpgrade={() => setUpgradeOpen(true)}
        />
      </div>

      <PasteModal isOpen={pasteOpen} onClose={() => setPasteOpen(false)} onLoad={loadPasted} />
      <UpgradeModal
        isOpen={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        ent={ent}
        reason={engine.paywall ?? undefined}
      />
    </div>
  );
}
