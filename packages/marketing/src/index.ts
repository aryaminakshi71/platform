/**
 * @platform/marketing — shared AI outreach module for all products.
 *
 * Framework-agnostic: provides personalization + channel senders.
 * The app owns the DB loop (campaigns/enrollments) and calls these functions.
 */

export type Channel = 'whatsapp' | 'email';

export interface MarketingEnv {
  OPENAI_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WHATSAPP_NUMBER?: string;
  TWILIO_PHONE_NUMBER?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

export interface Lead {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email: string;
  phone?: string | null;
}

export interface SequenceStep {
  day: number;
  subject?: string;
  message: string;
}

/** Rewrite a template into a concise, personalized message via OpenAI. */
export async function personalize(template: string, lead: Lead, env: MarketingEnv): Promise<string> {
  if (!env.OPENAI_API_KEY) return template;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Rewrite this outreach message to be concise, personal, and friendly. Keep it under 80 words. Do not invent facts. Return only the message.',
          },
          {
            role: 'user',
            content: `Lead: ${lead.firstName ?? 'there'} at ${lead.companyName ?? 'their company'}\n\n${template}`,
          },
        ],
      }),
    });
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || template;
  } catch {
    return template;
  }
}

export async function sendWhatsApp(env: MarketingEnv, to: string, body: string): Promise<boolean> {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_WHATSAPP_NUMBER: from } = env;
  if (!sid || !token || !from) return false;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${to}`, Body: body }).toString(),
  });
  return res.ok;
}

export async function sendSms(env: MarketingEnv, to: string, body: string): Promise<boolean> {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_PHONE_NUMBER: from } = env;
  if (!sid || !token || !from) return false;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
  return res.ok;
}

export async function sendEmail(env: MarketingEnv, to: string, subject: string, body: string): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  const from = env.RESEND_FROM || 'outreach@example.com';
  if (!key) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text: body }),
  });
  return res.ok;
}

/** Send one step to one lead. Returns true on success. */
export async function sendStep(
  env: MarketingEnv,
  channel: Channel,
  lead: Lead,
  step: SequenceStep,
): Promise<boolean> {
  const message = await personalize(step.message, lead, env);
  if (channel === 'whatsapp' && lead.phone) return sendWhatsApp(env, lead.phone, message);
  if (channel === 'email') return sendEmail(env, lead.email, step.subject || 'Quick question', message);
  return false;
}
