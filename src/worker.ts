interface Env {
  ANTHROPIC_API_KEY: string
  MAILS_API_URL: string
  MAILS_API_TOKEN: string
  MAILS_MAILBOX: string
  WEBHOOK_SECRET?: string
  SYSTEM_PROMPT?: string
}

interface WebhookPayload {
  event: string
  email_id: string
  mailbox: string
  from: string
  subject: string
  received_at?: string
  message_id?: string
  thread_id?: string
}

interface EmailDetail {
  id?: string
  from_address: string
  from_name: string
  subject: string
  body_text: string
  direction: string
  received_at?: string
  message_id?: string | null
  thread_id?: string | null
  in_reply_to?: string | null
}

interface ThreadEmail {
  id?: string
  from_address?: string
  direction?: string
  received_at?: string
  message_id?: string | null
  in_reply_to?: string | null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ name: "mails-monitor", status: "listening" })
    }

    const rawBody = await request.text()
    if (env.WEBHOOK_SECRET) {
      const valid = await verifyWebhookSignature(
        rawBody,
        request.headers.get("X-Webhook-Signature"),
        request.headers.get("X-Webhook-Signature-V2"),
        env.WEBHOOK_SECRET
      )
      if (!valid) {
        return Response.json({ error: "Invalid webhook signature" }, { status: 401 })
      }
    } else {
      console.warn("WEBHOOK_SECRET is not set; webhook signature verification is disabled")
    }

    let payload: WebhookPayload
    try {
      payload = JSON.parse(rawBody) as WebhookPayload
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 })
    }
    if (payload.event !== "message.received") {
      return Response.json({ skipped: true, reason: "not a new message" })
    }
    if (!payload.email_id) {
      return Response.json({ error: "Missing email_id" }, { status: 400 })
    }

    // Fetch full email content from mails-agent API
    const emailRes = await mailsApiFetch(env, `/email?id=${encodeURIComponent(payload.email_id)}`)
    if (!emailRes.ok) {
      return Response.json({ error: "Failed to fetch email" }, { status: 502 })
    }

    const email: EmailDetail = await emailRes.json()

    // Skip outbound emails (our own replies)
    if (email.direction === "outbound") {
      return Response.json({ skipped: true, reason: "outbound email" })
    }
    if (email.from_address.toLowerCase() === env.MAILS_MAILBOX.toLowerCase()) {
      return Response.json({ skipped: true, reason: "self email" })
    }

    if (await alreadyReplied(env, email)) {
      return Response.json({ skipped: true, reason: "already replied" })
    }

    // Call Claude API to generate a reply
    const systemPrompt =
      env.SYSTEM_PROMPT ??
      "You are a helpful AI email assistant. Reply concisely and professionally."

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Reply to this email.\n\nFrom: ${email.from_name || email.from_address}\nSubject: ${email.subject}\n\n${email.body_text}`,
          },
        ],
      }),
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.text()
      console.error(`Claude API error: ${claudeRes.status} ${err}`)
      return Response.json({ error: "Claude API failed" }, { status: 502 })
    }

    const claude: { content: Array<{ text: string }> } = await claudeRes.json()
    const replyText = claude.content[0]?.text?.trim() ?? ""
    if (!replyText) {
      return Response.json({ skipped: true, reason: "empty reply" })
    }

    // Send reply via mails-agent API
    const sendRes = await mailsApiFetch(env, "/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAILS_MAILBOX,
        to: [email.from_address],
        subject: email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`,
        text: replyText,
        ...(email.message_id ? { in_reply_to: email.message_id } : {}),
      }),
    })

    if (!sendRes.ok) {
      const err = await sendRes.text()
      console.error(`Send failed: ${sendRes.status} ${err}`)
      return Response.json({ error: "Failed to send reply" }, { status: 502 })
    }

    const sent: { id: string } = await sendRes.json()
    console.log(`Replied to ${email.from_address} re: "${email.subject}" -> ${sent.id}`)

    return Response.json({ replied: true, email_id: sent.id })
  },
} satisfies ExportedHandler<Env>

function apiPrefix(env: Env): "/api" | "/v1" {
  return env.MAILS_API_TOKEN.startsWith("mk_") || env.MAILS_API_URL === "https://api.mails0.com"
    ? "/v1"
    : "/api"
}

function mailsApiFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${env.MAILS_API_TOKEN}`)
  const url = new URL(`${apiPrefix(env)}${path}`, env.MAILS_API_URL)
  return fetch(url.toString(), { ...init, headers })
}

async function alreadyReplied(env: Env, email: EmailDetail): Promise<boolean> {
  if (!email.thread_id) return false
  try {
    const threadPath = `/thread?id=${encodeURIComponent(email.thread_id)}${apiPrefix(env) === "/api" ? `&to=${encodeURIComponent(env.MAILS_MAILBOX)}` : ""}`
    const threadRes = await mailsApiFetch(env, threadPath)
    if (!threadRes.ok) return false
    const data = await threadRes.json() as { emails?: ThreadEmail[] }
    const originalMessageId = email.message_id ?? null
    const originalReceivedAt = Date.parse(email.received_at ?? "")
    return (data.emails ?? []).some((item) => {
      if (item.direction !== "outbound") return false
      if (item.from_address?.toLowerCase() !== env.MAILS_MAILBOX.toLowerCase()) return false
      if (originalMessageId && item.in_reply_to === originalMessageId) return true
      if (!Number.isFinite(originalReceivedAt)) return false
      const sentAt = Date.parse(item.received_at ?? "")
      return Number.isFinite(sentAt) && sentAt >= originalReceivedAt
    })
  } catch {
    return false
  }
}

async function verifyWebhookSignature(
  body: string,
  signatureHeader: string | null,
  signatureV2Header: string | null,
  secret: string,
): Promise<boolean> {
  if (signatureV2Header) {
    return verifyTimestampedSignature(body, signatureV2Header, secret)
  }
  if (!signatureHeader) return false
  const expected = await signPayload(body, secret)
  const provided = signatureHeader.startsWith("sha256=") ? signatureHeader : `sha256=${signatureHeader}`
  return timingSafeEqual(provided, expected)
}

async function verifyTimestampedSignature(
  body: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const fields = new Map(
    signatureHeader.split(",").map((part) => {
      const [key, ...value] = part.split("=")
      return [key, value.join("=")]
    })
  )
  const timestamp = fields.get("t")
  const signature = fields.get("v1")
  if (!timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > 300) return false
  const expected = await signPayload(`${timestamp}.${body}`, secret)
  return timingSafeEqual(`sha256=${signature}`, expected)
}

async function signPayload(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body))
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `sha256=${hex}`
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
