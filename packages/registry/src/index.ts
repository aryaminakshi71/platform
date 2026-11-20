/**
 * Registry webhook helper
 *
 * Call these from each app's signup / billing handlers so the central
 * registry updates in real time (the batch sync is the fallback).
 *
 * Set REGISTRY_URL (default http://127.0.0.1:4100).
 */

const REGISTRY_URL = process.env.REGISTRY_URL ?? "http://127.0.0.1:4100";

export interface RegistryCompany {
  app: "schoolai" | "spectrumai" | "diagnoai" | "nucleoai";
  orgId: string;
  name: string;
  slug?: string;
  plan?: string;
  status?: string;
  email?: string;
  phone?: string;
  city?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  isDemo?: boolean;
  mrr?: number;
  currency?: string;
}

export interface RegistrySubscription {
  app: RegistryCompany["app"];
  orgId: string;
  plan?: string;
  status?: string;
  amount?: number;
  currency?: string;
  interval?: string;
  startedAt?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  stripeSubscriptionId?: string;
  mrr?: number;
}

async function post(path: string, body: unknown) {
  try {
    await fetch(`${REGISTRY_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Registry is optional; never block signup/billing on it.
  }
}

export function notifyRegistryCompany(company: RegistryCompany) {
  return post("/api/registry/company", company);
}

export function notifyRegistrySubscription(sub: RegistrySubscription) {
  return post("/api/registry/subscription", sub);
}
