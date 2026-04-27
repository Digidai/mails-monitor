#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const REQUIRED_VARS = [
  "ANTHROPIC_API_KEY",
  "MAILS_API_URL",
  "MAILS_API_TOKEN",
  "MAILS_MAILBOX",
] as const

// Load .env file if it exists
const envPath = resolve(process.cwd(), ".env")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
}

// Validate required env vars
const missing = REQUIRED_VARS.filter((v) => !process.env[v])
if (missing.length > 0) {
  console.error(`Missing required environment variables:\n  ${missing.join("\n  ")}`)
  console.error(`\nSet them in .env or export them in your shell.`)
  process.exit(1)
}

// Build wrangler args (--var KEY:VALUE for each env var)
const args = ["wrangler", "deploy"]
for (const v of REQUIRED_VARS) {
  args.push("--var", `${v}:${process.env[v]}`)
}
if (process.env.SYSTEM_PROMPT) {
  args.push("--var", `SYSTEM_PROMPT:${process.env.SYSTEM_PROMPT}`)
}
if (process.env.WEBHOOK_SECRET) {
  args.push("--var", `WEBHOOK_SECRET:${process.env.WEBHOOK_SECRET}`)
}

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")

console.log(`Deploying mails-monitor...`)
console.log(`  Mailbox: ${process.env.MAILS_MAILBOX}`)
console.log(`  API:     ${process.env.MAILS_API_URL}`)

try {
  execFileSync("npx", args, { cwd: workerDir, stdio: "inherit" })
  console.log(`\nmails-monitor deployed. Webhook URL is shown above.`)
  console.log(`Set it as your mailbox webhook in mails-agent to start auto-replying.`)
} catch {
  process.exit(1)
}
