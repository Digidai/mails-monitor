# mails-monitor

AI inbox watcher that auto-responds to emails using Claude. A demo product for the [mails-agent](https://github.com/Digidai/mails) ecosystem.

**How it works:** Email arrives at your mails address -> webhook fires -> Claude generates a reply -> reply is sent back.

## Quick Start

1. Create a `.env` file:

```env
ANTHROPIC_API_KEY=sk-ant-...
MAILS_API_URL=https://mails-worker.yourdomain.workers.dev
MAILS_API_TOKEN=your-mails-api-token
MAILS_MAILBOX=you@yourdomain.com
# Optional:
# SYSTEM_PROMPT="You are a sarcastic robot who replies in haiku."
```

2. Deploy:

```bash
npx mails-monitor
```

3. Set the deployed Worker URL as your mailbox webhook in mails-agent.

That's it. Every inbound email will get an AI-generated reply.

## Architecture

Single Cloudflare Worker. Zero dependencies.

```
Incoming Email
     |
     v
mails-agent Worker (stores email, fires webhook)
     |
     v
mails-monitor Worker (this project)
  1. Fetches full email via /api/email
  2. Calls Claude API to generate reply
  3. Sends reply via /api/send
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `MAILS_API_URL` | Yes | Base URL of your mails-agent Worker |
| `MAILS_API_TOKEN` | Yes | Auth token for the mails-agent API |
| `MAILS_MAILBOX` | Yes | Your email address (used as the "from" address) |
| `SYSTEM_PROMPT` | No | Custom system prompt for Claude |

## Development

```bash
npm install
npm run dev    # Local dev server via wrangler
npm run deploy # Deploy to Cloudflare
```

## License

MIT
