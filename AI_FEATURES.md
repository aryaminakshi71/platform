# AI Feature Inventory & Competitive Differentiation

What AI each product ships, and where it goes beyond the usual competitor feature set.

> Status legend: **Live** = wired to an API route and UI · **Service** = implemented in the API, UI partial · **UI** = component exists, not yet wired to a live endpoint.

---

## SchoolAI — School MIS

| Feature | What it does | Status | Typical competitor |
|---|---|---|---|
| Role-aware AI chat assistant | Answers academic, career, admissions, fee, transport questions differently for student / teacher / parent / admin | Service + UI | Rare — most MIS ship a generic FAQ bot |
| Student performance prediction | Predicts a success score from grades + attendance, returns reasoning and recommendations | Live (`/api/ai/student/performance`) | Rare — usually static analytics |
| Attendance pattern analysis | Detects absence patterns and flags low / medium / high risk | Live (`/api/ai/attendance/analyze`) | Rare |
| Essay auto-grading | Rubric-based scoring with per-criterion feedback | Service + UI | Add-on in a few (e.g. Gradescope), not native to MIS |
| Study plan generation | Personalised study plan from performance data | Service | Rare |
| Homework help | Subject-aware tutoring | Service | Rare |
| AI content generator | Lesson plans, quizzes, announcements | UI | Common in newer tools |
| AI meeting summarizer | Summarises parent/teacher meetings | UI | Rare |
| AI peer review | Structured peer feedback on assignments | UI | Very rare |
| AI teaching assistant | In-class assistant with attachments | UI | Rare |
| AI anti-cheating | Behavioural proctoring signals during exams | UI | Usually a separate proctoring vendor |
| Emotional AI chatbot | Sentiment-aware student support | UI | Very rare |
| Brain-computer interface | Experimental attention/engagement signals | UI (experimental) | Not offered by mainstream MIS |

**Differentiators vs PowerSchool / Infinite Campus / Fedena / Teachmint:** emotional AI support, AI anti-cheating, AI peer review, and performance prediction are native rather than bolt-ons.

---

## SpectrumAI — Autism Care Platform

| Feature | What it does | Status | Typical competitor |
|---|---|---|---|
| AI lead scoring | Scores enquiries by fit/value with reasoning and factors | Live (`/api/ai/score-lead`) | Rare in clinical platforms |
| AI email suggestions | Drafts follow-up / intro / proposal / meeting-request emails | Live (`/api/ai/email-suggestions`) | Rare |
| AI meeting summary | Turns session/meeting notes into a summary | Live (`/api/ai/meeting-summary`) | Some (e.g. CentralReach add-ons) |
| AI contact enrichment | Adds context to a contact record | Live (`/api/ai/enrich-contact`) | Rare |
| Clinical operations command | Unified centre operations view | Live | Common |
| Session notes / ABA workflows | Structured clinical documentation | Live | Common |

**Differentiators vs CentralReach / Rethink / Theralytics:** AI lead scoring and contact enrichment on the intake side, plus AI meeting summaries, are unusual for autism-care platforms that focus only on clinical documentation.

---

## DiagnoAI — Laboratory Information System

| Feature | What it does | Status | Typical competitor |
|---|---|---|---|
| AI result interpretation | Doctor-facing summary + abnormal-result explanations | Live (`/api/rpc/ai/interpret`) | Rare — most LIS are rule-based |
| AI abnormal-result explainer | 1–2 sentence explanation of why a result is abnormal | Live (`/api/rpc/ai/explain`) | Rare |
| Patient-friendly report summary | Plain-language summary for patient/owner | Live (`/api/rpc/ai/summarize`) | Rare |
| PHI redaction guardrail | Strips phone/email/SSN/card/date before any model call | Live (`@platform/ai`) | Rare — most vendors don't document this |
| Human **and** veterinary labs | One codebase, `VITE_LAB_TYPE=human\|veterinary\|both` | Live | Usually separate products |
| Branded PDF reports | Org name + colour on every report | Live | Common |

**Differentiators vs Crelio / Medsynaptic / LabLIMS / VetPACS:** AI interpretation with an explicit PHI guardrail, and a single product that serves both human and veterinary labs.

---

## NucleoAI — Business OS (15 modules)

| Feature | What it does | Status | Typical competitor |
|---|---|---|---|
| AI agents | Create, run, chat with, and orchestrate agents | Live (`/agents/*`) | Add-on in HubSpot/Salesforce, not core |
| Agent orchestration | Multi-step workflows with triggers | Live | Rare |
| Agent sandbox | Safe test environment for agent runs | Live | Rare |
| Agent templates | Prebuilt agent starting points | Live | Rare |
| Speech suite | Transcription (Whisper), speaker profiles, voice commands, meetings, vocabulary, models | Live (`/speech/*`) | Usually a separate vendor |
| AI outreach personalisation | Rewrites campaign messages per lead (cron) | Live (`marketing-cron`) | Common in sales tools |
| AI copilot | In-app assistant | Live | Common |
| 15 equal modules | CRM, projects, helpdesk, HRM, inventory, monitoring, communications, field service, DevOps, finance, marketing, ecommerce, agents, analytics, integrations | Live | Competitors sell these as separate SKUs |

**Differentiators vs Salesforce / HubSpot / Zoho / Monday / Odoo:** agents + orchestration + sandbox and a built-in speech suite are core, not add-ons; 15 modules at one price instead of per-SKU pricing.

---

## Shared AI infrastructure

- **`@platform/ai`** — OpenAI wrapper with `redactPHI`, `chatJSON`, `generateText`.
- **`@platform/email`** — branded transactional email (verification, reset, welcome, invite, invoice, receipt).
- **Provider abstraction** — each app has an `ai.ts` client supporting OpenAI (and Cloudflare Workers AI where configured), with graceful fallback when no key is set.

## Honest gaps

- SchoolAI's essay grader, study plan, homework help, and several AI UI components are implemented but not yet exposed through API routes — they need wiring before they can be sold as live features.
- DiagnoAI's AI routes require `OPENAI_API_KEY`; without it they return `null` and the UI shows a "not configured" state.
- NucleoAI's agent runner uses OpenRouter/Gemini; it needs `OPENROUTER_API_KEY` or `OPENAI_API_KEY`.
