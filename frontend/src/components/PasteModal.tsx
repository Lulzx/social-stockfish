import { useMemo, useState } from "react";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  Textarea,
} from "@heroui/react";
import { parseConversation } from "../parseConversation";
import type { Message } from "../types";

let _pid = 1000;

export function PasteModal({
  isOpen,
  onClose,
  onLoad,
}: {
  isOpen: boolean;
  onClose: () => void;
  onLoad: (messages: Message[], contact: string) => void;
}) {
  const [raw, setRaw] = useState("");
  const [me, setMe] = useState<string>("");

  const parsed = useMemo(() => parseConversation(raw), [raw]);
  const participants = parsed.participants;

  // default "me" to the second participant (often you reply second); pick once known
  const effectiveMe = me || participants[participants.length - 1] || "";

  const load = () => {
    if (!parsed.messages.length || !effectiveMe) return;
    const messages: Message[] = parsed.messages.map((m) => ({
      id: `p${_pid++}`,
      sender: m.sender === effectiveMe ? "me" : "them",
      text: m.text,
    }));
    const them = participants.find((p) => p !== effectiveMe) || "Them";
    onLoad(messages, them);
    setRaw("");
    setMe("");
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span className="text-[17px] font-bold">Paste a conversation</span>
          <span className="text-[12px] font-normal text-default-400">
            Export a chat from WhatsApp or Telegram and paste it here to analyze move by move.
          </span>
        </ModalHeader>
        <ModalBody>
          <Textarea
            value={raw}
            onValueChange={setRaw}
            minRows={8}
            maxRows={16}
            placeholder={
              "Paste here, e.g.\n\n[7/6/26, 11:54:27 AM] Annie: how's your project going?\n[7/6/26, 11:55:01 AM] You: honestly kinda stuck rn\n\n…or Telegram / 'Name: message' formats."
            }
            classNames={{ input: "text-[13px] font-mono" }}
          />
          {participants.length > 0 && (
            <div className="mt-1">
              <div className="mb-1 text-[12px] font-semibold text-default-600">
                Detected {parsed.messages.length} messages. Which one is you?
              </div>
              <RadioGroup
                orientation="horizontal"
                value={effectiveMe}
                onValueChange={setMe}
                classNames={{ wrapper: "gap-4" }}
              >
                {participants.map((p) => (
                  <Radio key={p} value={p} size="sm">
                    {p}
                  </Radio>
                ))}
              </RadioGroup>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            isDisabled={!parsed.messages.length || !effectiveMe}
            onPress={load}
            className="bg-[#0a84ff] font-semibold text-white"
          >
            Load {parsed.messages.length ? `${parsed.messages.length} messages` : ""}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
