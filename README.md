# mails-monitor

AI inbox watcher that auto-responds to emails using Claude. A demo product for the [mails-agent](https://github.com/Digidai/mails) ecosystem.

**How it works:** Email arrives at your mails address -> webhook fires -> Claude generates a reply -> reply is sent back. The Worker verifies signed webhooks when configured and skips emails it has already replied to.

## Quick Start

1. Create a `.env` file:

```env
ANTHROPIC_API_KEY=sk-ant-...
MAILS_API_URL=https://api.mails0.com
MAILS_API_TOKEN=mk_your_mailbox_api_key
MAILS_MAILBOX=you@yourdomain.com
# Optional:
# WEBHOOK_SECRET=same-secret-as-mails-worker
# SYSTEM_PROMPT="You are a sarcastic robot who replies in haiku."
```

2. Deploy:

```bash
npx mails-monitor
```

3. Set the deployed Worker URL as your mailbox webhook in mails-agent.

For self-hosted mails-agent Workers, set `MAILS_API_URL` to your Worker URL and use your Worker token. For the hosted `https://api.mails0.com` service or any `mk_` token, mails-monitor automatically uses `/v1/*` routes.

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
  1. Fetches full email via the mails API
  2. Calls Claude API to generate reply
  3. Sends reply via the mails API with `in_reply_to`
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `MAILS_API_URL` | Yes | Base URL of hosted mails0 or your self-hosted mails-agent Worker |
| `MAILS_API_TOKEN` | Yes | Hosted `mk_` API key or self-hosted Worker token |
| `MAILS_MAILBOX` | Yes | Your email address (used as the "from" address) |
| `WEBHOOK_SECRET` | No | Verifies signed webhooks from mails-agent when set. Supports replay-resistant `X-Webhook-Signature-V2` and legacy signatures. |
| `SYSTEM_PROMPT` | No | Custom system prompt for Claude |

## Development

```bash
npm install
npm run dev    # Local dev server via wrangler
npm run deploy # Deploy to Cloudflare
```

## License

MIT
