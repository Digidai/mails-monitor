interface Env {
  ANTHROPIC_API_KEY: string
  MAILS_API_URL: string
  MAILS_API_TOKEN: string
  MAILS_MAILBOX: string
  SYSTEM_PROMPT?: string
}

interface WebhookPayload {
  event: string
  email_id: string
  mailbox: string
  from: string
  subject: string
}

interface EmailDetail {
  from_address: string
  from_name: string
  subject: string
  body_text: string
  direction: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ name: "mails-monitor", status: "listening" })
    }

    const payload: WebhookPayload = await request.json()
    if (payload.event !== "message.received") {
      return Response.json({ skipped: true, reason: "not a new message" })
    }

    // Fetch full email content from mails-agent API
    const emailRes = await fetch(
      `${env.MAILS_API_URL}/api/email?id=${payload.email_id}`,
      { headers: { Authorization: `Bearer ${env.MAILS_API_TOKEN}` } }
    )
    if (!emailRes.ok) {
      return Response.json({ error: "Failed to fetch email" }, { status: 502 })
    }

    const email: EmailDetail = await emailRes.json()

    // Skip outbound emails (our own replies)
    if (email.direction === "outbound") {
      return Response.json({ skipped: true, reason: "outbound email" })
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
    const replyText = claude.content[0]?.text ?? ""

    // Send reply via mails-agent API
    const sendRes = await fetch(`${env.MAILS_API_URL}/api/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MAILS_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAILS_MAILBOX,
        to: [email.from_address],
        subject: email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`,
        text: replyText,
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
