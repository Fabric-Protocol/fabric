import { config } from '../config.js';

type EmailSendInput = {
  to: string;
  subject: string;
  text: string;
};

type EmailSendResult = {
  ok: boolean;
  provider: 'stub' | 'smtp' | 'sendgrid' | 'resend';
  reason?: string;
};

type StubEmailMessage = {
  to: string;
  subject: string;
  text: string;
  code: string | null;
  created_at: string;
};

const stubOutbox = new Map<string, StubEmailMessage>();
let smtpTransporter: any = null;

function extractOneTimeCode(text: string) {
  const match = /\b(\d{6})\b/.exec(text);
  return match ? match[1] : null;
}

export function getStubEmailMessage(email: string) {
  return stubOutbox.get(email.trim().toLowerCase()) ?? null;
}

export function getStubEmailCode(email: string) {
  return getStubEmailMessage(email)?.code ?? null;
}

export function clearStubEmailOutbox() {
  stubOutbox.clear();
}

async function sendViaStub(input: EmailSendInput): Promise<EmailSendResult> {
  const normalizedEmail = input.to.trim().toLowerCase();
  const message: StubEmailMessage = {
    to: normalizedEmail,
    subject: input.subject,
    text: input.text,
    code: extractOneTimeCode(input.text),
    created_at: new Date().toISOString(),
  };
  stubOutbox.set(normalizedEmail, message);
  return { ok: true, provider: 'stub' };
}

async function sendViaSendgrid(input: EmailSendInput): Promise<EmailSendResult> {
  if (!config.sendgridApiKey) return { ok: false, provider: 'sendgrid', reason: 'sendgrid_api_key_missing' };
  if (!config.emailFrom) return { ok: false, provider: 'sendgrid', reason: 'email_from_missing' };
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: config.emailFrom },
        subject: input.subject,
        content: [{ type: 'text/plain', value: input.text }],
      }),
    });
    if (!res.ok) return { ok: false, provider: 'sendgrid', reason: `sendgrid_http_${res.status}` };
    return { ok: true, provider: 'sendgrid' };
  } catch {
    return { ok: false, provider: 'sendgrid', reason: 'sendgrid_network_error' };
  }
}

const RESEND_MAX_RETRIES = 2;
const RESEND_RETRY_BASE_MS = 500;

async function sendViaResend(input: EmailSendInput): Promise<EmailSendResult> {
  if (!config.resendApiKey) return { ok: false, provider: 'resend', reason: 'resend_api_key_missing' };
  if (!config.emailFrom) return { ok: false, provider: 'resend', reason: 'email_from_missing' };
  const payload = JSON.stringify({
    from: config.emailFrom,
    to: [input.to],
    subject: input.subject,
    text: input.text,
  });
  for (let attempt = 0; attempt <= RESEND_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      });
      if (res.status === 429 && attempt < RESEND_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RESEND_RETRY_BASE_MS * Math.pow(2, attempt)));
        continue;
      }
      if (!res.ok) return { ok: false, provider: 'resend', reason: `resend_http_${res.status}` };
      return { ok: true, provider: 'resend' };
    } catch {
      if (attempt < RESEND_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RESEND_RETRY_BASE_MS * Math.pow(2, attempt)));
        continue;
      }
      return { ok: false, provider: 'resend', reason: 'resend_network_error' };
    }
  }
  return { ok: false, provider: 'resend', reason: 'resend_retries_exhausted' };
}

async function smtpTransport() {
  if (smtpTransporter) return smtpTransporter;
  const nodemailerModuleName = 'nodemailer';
  const nodemailer = await import(nodemailerModuleName).catch(() => null as any);
  const createTransport = nodemailer?.createTransport ?? nodemailer?.default?.createTransport;
  if (!createTransport) return null;
  smtpTransporter = createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser && config.smtpPass ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
  });
  return smtpTransporter;
}

async function sendViaSmtp(input: EmailSendInput): Promise<EmailSendResult> {
  if (!config.smtpHost) return { ok: false, provider: 'smtp', reason: 'smtp_host_missing' };
  if (!config.emailFrom) return { ok: false, provider: 'smtp', reason: 'email_from_missing' };
  const transporter = await smtpTransport();
  if (!transporter) return { ok: false, provider: 'smtp', reason: 'smtp_dependency_missing' };
  try {
    await transporter.sendMail({
      from: config.emailFrom,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { ok: true, provider: 'smtp' };
  } catch {
    return { ok: false, provider: 'smtp', reason: 'smtp_send_failed' };
  }
}

export async function sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
  if (config.emailProvider === 'resend') return sendViaResend(input);
  if (config.emailProvider === 'sendgrid') return sendViaSendgrid(input);
  if (config.emailProvider === 'smtp') return sendViaSmtp(input);
  return sendViaStub(input);
}

type SlackSendResult = { ok: boolean; reason?: string };

export async function sendSlack(text: string): Promise<SlackSendResult> {
  const url = config.slackOpsWebhookUrl;
  if (!url) return { ok: false, reason: 'slack_webhook_url_not_configured' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return { ok: false, reason: `slack_http_${res.status}` };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'slack_network_error' };
  }
}
