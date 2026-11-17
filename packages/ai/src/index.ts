/**
 * @platform/ai — shared OpenAI wrapper with PHI guardrails.
 *
 * Use for: report summaries, claim drafts, lead scoring, copilots.
 * Always de-identify PHI before calling (helpers below).
 */

export interface AIEnv {
  OPENAI_API_KEY?: string;
  AI_MODEL?: string;
}

export function isConfigured(env: AIEnv): boolean {
  return !!env.OPENAI_API_KEY;
}

/** Redact common PHI/PII before sending to the model. */
export function redactPHI(text: string): string {
  return text
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')
    .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD]')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[DATE]');
}

async function chat(
  env: AIEnv,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  json: boolean,
): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.AI_MODEL || 'gpt-4o-mini',
        messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/** Return parsed JSON (or null if AI unavailable/invalid). */
export async function chatJSON<T>(env: AIEnv, system: string, user: string): Promise<T | null> {
  const raw = await chat(env, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], true);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Return plain text (or null). */
export async function generateText(env: AIEnv, system: string, user: string): Promise<string | null> {
  return chat(env, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], false);
}
