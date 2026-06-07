import { useEffect, useState } from "react";
import { Modal, ModalBody, ModalContent, ModalHeader, Spinner } from "@heroui/react";
import type { Candidate, Message } from "../types";

interface Sim {
  trajectory: { sender: "me" | "them"; text: string }[];
  score: number;
}

export function SimulateModal({
  candidate,
  goal,
  messages,
  onClose,
}: {
  candidate: Candidate | null;
  goal: string;
  messages: Message[];
  onClose: () => void;
}) {
  const [sim, setSim] = useState<Sim | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!candidate) return;
    setSim(null);
    setLoading(true);
    const ctrl = new AbortController();
    fetch("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal,
        move: candidate.text,
        messages: messages.map((m) => ({ sender: m.sender, text: m.text })),
      }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSim(d))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [candidate, goal, messages]);

  return (
    <Modal isOpen={!!candidate} onClose={onClose} size="md" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span className="text-[15px] font-bold">Simulated rollout</span>
          <span className="text-[12px] font-normal text-default-400">
            One way this opening move could play out
          </span>
        </ModalHeader>
        <ModalBody className="pb-5">
          {candidate?.strategy && (
            <span className="w-fit rounded-full bg-default-100 px-2 py-0.5 text-[11px] font-medium text-default-500">
              {candidate.strategy}
            </span>
          )}
          {loading && (
            <div className="flex items-center gap-2 py-6 text-[13px] text-default-400">
              <Spinner size="sm" color="default" /> simulating this path...
            </div>
          )}
          {sim && (
            <>
              <div className="flex flex-col gap-1.5">
                {sim.trajectory.map((m, i) => {
                  const mine = m.sender === "me";
                  return (
                    <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-[16px] px-3 py-1.5 text-[13.5px] leading-snug ${
                          mine ? "bg-[#0a84ff] text-white" : "bg-[#e9e9eb] text-black"
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-default-500">
                <span>outcome score</span>
                <span className="rounded-md bg-default-900 px-1.5 py-0.5 font-bold tabular-nums text-white">
                  {sim.score.toFixed(2)}
                </span>
              </div>
            </>
          )}
          {!loading && !sim && (
            <div className="py-6 text-center text-[13px] text-default-400">
              Couldn’t simulate this path. Try another dot.
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
