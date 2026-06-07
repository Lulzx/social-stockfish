import { useEffect, useState } from "react";
import { ChatPane } from "./components/ChatPane";
import { EnginePane } from "./components/EnginePane";
import { EvalBar } from "./components/EvalBar";
import { PasteModal } from "./components/PasteModal";
import { useEngine } from "./useEngine";
import type { Message, RankedResult, Sender } from "./types";

let _id = 0;
const mkId = () => `m${_id++}`;
const seed = (sender: Message["sender"], text: string): Message => ({ id: mkId(), sender, text });

// Demo conversation from the original Social Stockfish clip.
const SEED_MESSAGES: Message[] = [
  seed("them", "how's your project going?"),
  seed("me", "honestly kinda stuck rn"),
  seed("me", "what are you working on??"),
  seed("them", "same, brains completely fried"),
  seed("them", "recommendation system for finding spots on campus"),
  seed("me", "oh cool! i actually know some good ones"),
  seed("them", "really? like where?"),
];

const SEED_GOAL = "rizz annie up at columbia's hackathon";

export default function App() {
  const [messages, setMessages] = useState<Message[]>(SEED_MESSAGES);
  const [goal, setGoal] = useState(SEED_GOAL);
  const [contact, setContact] = useState("Annie");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [activeMove, setActiveMove] = useState<number | null>(null);
  const [tab, setTab] = useState<"chat" | "engine">("chat");
  const { state: engine, analyze, review, loadReview, reset } = useEngine();

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
    analyze(messages, goal, contact);
  };
  const runReview = () => {
    setTab("engine");
    review(messages, goal, contact);
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
          onGoalChange={setGoal}
          onPick={pick}
          onAnalyze={runAnalyze}
          onReview={runReview}
          onPaste={() => setPasteOpen(true)}
          onActiveMove={setActiveMove}
        />
      </div>

      <PasteModal isOpen={pasteOpen} onClose={() => setPasteOpen(false)} onLoad={loadPasted} />
    </div>
  );
}
