import { useMemo, useState } from "react";
import { ChatPane } from "./components/ChatPane";
import { EnginePane } from "./components/EnginePane";
import { EvalBar } from "./components/EvalBar";
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
  const { state: engine, analyze } = useEngine();

  // Analysis runs only on demand (Analyze button), never automatically.
  const send = (text: string, sender: Sender) =>
    setMessages((m) => [...m, seed(sender, text)]);
  // Picking a suggested move adds it as *your* sent message.
  const pick = (r: RankedResult) => setMessages((m) => [...m, seed("me", r.text)]);

  const bestScore = useMemo(
    () => (engine.ranked.length ? engine.ranked[0].score : null),
    [engine.ranked]
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      {/* Stockfish-style evaluation bar */}
      <EvalBar score={bestScore} />
      {/* chat pane */}
      <div className="w-1/2 min-w-[320px] border-r border-default-200">
        <ChatPane
          contact={contact}
          unread={5}
          messages={messages}
          onContactChange={setContact}
          onSend={send}
        />
      </div>
      {/* engine pane */}
      <div className="min-w-0 flex-1">
        <EnginePane
          engine={engine}
          goal={goal}
          onGoalChange={setGoal}
          onPick={pick}
          onAnalyze={() => analyze(messages, goal, contact)}
        />
      </div>
    </div>
  );
}
