// Parse pasted chat exports (WhatsApp / Telegram / generic) into messages.
//
// Supported headers:
//   WhatsApp Android: 07/06/2026, 11:54 - Name: message
//   WhatsApp iOS:     [07/06/2026, 11:54:27 AM] Name: message
//   Telegram copy:    Name, [7 Jun 2026 at 11:54:27 AM]:   (text on following lines)
//   Generic:          Name: message
// Continuation lines (no header) are appended to the previous message.

export interface ParsedMessage {
  sender: string; // raw participant name
  text: string;
  ts?: string;
}

export interface ParsedConversation {
  messages: ParsedMessage[];
  participants: string[];
}

// WhatsApp: optional [ ] wrapper, a date, time (optional seconds + AM/PM), then "- " or "] ", Name: text
const WA = /^\[?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}),?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?\s*(?:\]\s*|-\s*)([^:]{1,40}?):\s?([\s\S]*)$/;
// Telegram "Name, [date]:" header (text follows on next lines)
const TG = /^(.{1,40}?),\s*\[([^\]]+)\]:\s*$/;
// Generic "Name: text" — only used as a fallback; name kept short & tame
const GENERIC = /^([A-Za-z0-9][\w .'\-]{0,28}):\s+(\S[\s\S]*)$/;

const SYSTEM_HINTS = [
  "end-to-end encrypted",
  "Messages and calls are",
  "created group",
  "changed the subject",
  "joined using this group",
  "<Media omitted>",
];

function isSystem(line: string): boolean {
  return SYSTEM_HINTS.some((h) => line.includes(h));
}

export function parseConversation(raw: string): ParsedConversation {
  const lines = raw.replace(/\r/g, "").split("\n");
  const messages: ParsedMessage[] = [];
  let cur: ParsedMessage | null = null;
  const push = () => {
    if (cur && cur.text.trim()) messages.push({ ...cur, text: cur.text.trim() });
    cur = null;
  };
  // Detect whether any timestamped headers exist; if so, don't fall back to the
  // greedy generic matcher (avoids splitting message bodies that contain colons).
  const hasTimestamps = lines.some((l) => WA.test(l) || TG.test(l));

  for (const line of lines) {
    if (isSystem(line)) continue;
    let m = line.match(WA);
    if (m) {
      // groups: 1 = date, 2 = sender name, 3 = message text
      push();
      cur = { sender: m[2].trim(), text: m[3] ?? "", ts: m[1] };
      continue;
    }
    m = line.match(TG);
    if (m) {
      push();
      cur = { sender: m[1].trim(), text: "", ts: m[2].trim() };
      continue;
    }
    if (!hasTimestamps) {
      m = line.match(GENERIC);
      if (m) {
        push();
        cur = { sender: m[1].trim(), text: m[2] };
        continue;
      }
    }
    // continuation
    if (cur && line.trim()) cur.text += (cur.text ? " " : "") + line.trim();
  }
  push();

  const participants: string[] = [];
  for (const msg of messages) if (!participants.includes(msg.sender)) participants.push(msg.sender);

  return { messages, participants };
}
