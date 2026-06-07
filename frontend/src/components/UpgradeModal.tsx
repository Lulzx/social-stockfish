import { useState } from "react";
import { Button, Input, Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/react";
import { deviceId, type Entitlement } from "../lib";

const PERKS = [
  "Unlimited Game Reviews of any conversation",
  "Coach James reads every move out loud",
  "The full move-by-move breakdown & eval graph",
  "Priority, faster analysis",
];

export function UpgradeModal({
  isOpen,
  onClose,
  ent,
  reason,
}: {
  isOpen: boolean;
  onClose: () => void;
  ent: Entitlement;
  reason?: string;
}) {
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(false);

  const checkout = async () => {
    setLoading(true);
    try {
      const r = await fetch("/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: deviceId() }),
      });
      const d = await r.json();
      if (d.url) location.href = d.url;
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const join = async () => {
    if (!email.includes("@")) return;
    setLoading(true);
    try {
      await fetch("/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, note: reason || "upgrade" }),
      });
      setJoined(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 pb-0">
          <span className="text-[20px] font-extrabold tracking-tight">Go Pro</span>
          <span className="text-[13px] font-normal text-default-500">
            {reason === "review"
              ? "You’ve used your free Game Reviews. Unlock unlimited coaching."
              : "Your coach for the conversations that actually matter."}
          </span>
        </ModalHeader>
        <ModalBody className="pb-6">
          <ul className="my-2 flex flex-col gap-2">
            {PERKS.map((p) => (
              <li key={p} className="flex items-start gap-2 text-[14px] text-default-700">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#7cae3e] text-[10px] font-bold text-white">
                  ✓
                </span>
                {p}
              </li>
            ))}
          </ul>

          {ent.billingEnabled ? (
            <Button
              onPress={checkout}
              isLoading={loading}
              size="lg"
              className="mt-2 w-full bg-[#0a84ff] text-[15px] font-bold text-white"
            >
              Get Pro
            </Button>
          ) : joined ? (
            <div className="mt-2 rounded-xl bg-[#7cae3e]/10 px-4 py-3 text-center text-[13px] font-medium text-[#4d7a1f]">
              You’re on the list — we’ll email you when Pro opens up. 🙌
            </div>
          ) : (
            <div className="mt-2">
              <p className="mb-2 text-[12px] text-default-500">
                Pro isn’t open to the public yet. Drop your email and you’ll get first access.
              </p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={email}
                  onValueChange={setEmail}
                  placeholder="you@work.com"
                  variant="bordered"
                  onKeyDown={(e) => e.key === "Enter" && join()}
                  classNames={{ inputWrapper: "bg-white" }}
                />
                <Button
                  onPress={join}
                  isLoading={loading}
                  isDisabled={!email.includes("@")}
                  className="bg-[#0a84ff] font-semibold text-white"
                >
                  Join
                </Button>
              </div>
            </div>
          )}
          <p className="mt-3 text-center text-[11px] text-default-400">
            Your conversations stay private — nothing is stored unless you share or opt in.
          </p>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
