/**
 * Content Moderation Plugin
 * 
 * Core: Message moderation via OpenClaw hooks
 */

// Simple in-memory keyword store
const keywords: Set<string> = new Set([
  "敏感词1",
  "敏感词2"
]);

// Hook handler function
async function handler(event: {
  type: string;
  action: string;
  text?: string;
  cancel?: boolean;
  cancelReason?: string;
}) {
  // Only process message received events
  if (event.type !== "message" || event.action !== "received") {
    return;
  }

  const text = event.text || "";
  if (!text) return;

  // Check against keywords (case-insensitive)
  for (const keyword of keywords) {
    if (text.toLowerCase().includes(keyword.toLowerCase())) {
      event.cancel = true;
      event.cancelReason = `Contains keyword: ${keyword}`;
      return;
    }
  }
}

export default handler;
