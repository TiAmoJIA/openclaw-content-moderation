---
name: content-moderation
description: "Message content moderation via keyword filtering"
homepage: https://github.com/TiAmoJIA/openclaw-content-moderation
metadata:
  { "openclaw": { "emoji": "🛡️", "events": ["message:received"] } }
---

# Content Moderation Hook

Blocks messages containing configured keywords.

## Events

- `message:received` - Intercept inbound messages

## Keywords

Currently supports simple keyword matching (case-insensitive).

## Configuration

Edit the keywords array in handler.ts to customize blocked terms.
