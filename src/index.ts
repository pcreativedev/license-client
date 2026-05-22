/**
 * @pcreative/license-client — universal license verification helper
 *
 * Designed to be dropped into any template (Next.js, Express, Vite+Express).
 * Verifies JWT licenses offline with the embedded public key, with optional
 * heartbeat-based remote re-verification (24h cadence).
 *
 * Storage convention:
 *   - `.pcreative-license.json` at the project root contains the active JWT + metadata.
 *   - The user fills it manually OR via the Setup Wizard UI.
 *
 * Environment variable overrides (.env):
 *   - PCREATIVE_LICENSE_KEY       (raw license key)
 *   - PCREATIVE_LICENSE_DOMAIN    (force a specific domain, otherwise host header)
 *   - PCREATIVE_LICENSE_API       (default https://api.pcreative.dev)
 */

import fs from "node:fs";
import path from "node:path";
import { jwtVerify, importSPKI } from "jose";

// =============================================================================
// EMBEDDED PUBLIC KEY — generated from /api/license/pubkey on 2026-05-22.
// This is the ONLY thing the template needs to verify JWTs offline.
// =============================================================================
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy7OtwWHOMmhJiUERABDt
ILypQ2fTNWtyoF5TNjqq6fMbSF6r9JXxkiiWZhqew0PcHg3SvU/q9HJ0o+RCoKRu
IRnkIRys3yghwOsDXq2IHUjnxH/XycB8w3NsevKl09rHltdSAGUL4YkA2bWdIknd
Ae2GPIt4nbewK3sO6ZnsC2jaLqUvB7I4vl4zxVVoj8yIOmy+AA15r81fERquUCTH
-----END PUBLIC KEY-----`;

// NOTE: replace this constant with the actual pubkey from your account
// (curl https://api.pcreative.dev/api/license/pubkey). The template ships
// with the pcreative.dev pubkey embedded so no network call is needed to verify.

const API_BASE = process.env.PCREATIVE_LICENSE_API || "https://api.pcreative.dev";
const STORAGE_FILE = ".pcreative-license.json";
const STORAGE_PATH = path.resolve(process.cwd(), STORAGE_FILE);

export interface LicensePayload {
  sub: string;          // license key
  product: string;      // product slug (e.g., "aurora")
  domain: string;       // bound domain
  type: "regular" | "extended";
  extended: boolean;
  watermark: string;    // unique tracking id
  email: string;
  iat: number;
  exp: number;
  iss: string;          // "pcreative.dev"
  aud: string;
  jti: string;
}

export interface StoredLicense {
  jwt: string;
  payload: LicensePayload;
  invalid_since: string | null; // ISO timestamp set when verification starts failing
  last_heartbeat: string | null;
}

// =============================================================================
// Storage
// =============================================================================
export function loadStored(): StoredLicense | null {
  try {
    return JSON.parse(fs.readFileSync(STORAGE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveStored(data: StoredLicense): void {
  fs.writeFileSync(STORAGE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function clearStored(): void {
  try { fs.unlinkSync(STORAGE_PATH); } catch {}
}

// =============================================================================
// JWT verification (offline, with embedded public key)
// =============================================================================
let cachedPublicKey: Awaited<ReturnType<typeof importSPKI>> | null = null;

async function getPublicKey() {
  if (!cachedPublicKey) {
    cachedPublicKey = await importSPKI(LICENSE_PUBLIC_KEY, "RS256");
  }
  return cachedPublicKey;
}

export async function verifyJwt(jwt: string, product: string): Promise<LicensePayload | null> {
  try {
    const pubKey = await getPublicKey();
    const { payload } = await jwtVerify(jwt, pubKey, {
      issuer: "pcreative.dev",
      audience: product,
    });
    return payload as unknown as LicensePayload;
  } catch {
    return null;
  }
}

// =============================================================================
// Remote activation + heartbeat
// =============================================================================
export interface ActivateInput {
  licenseKey: string;
  product: string;
  domain: string;
}

export interface ActivateResult {
  valid: boolean;
  jwt?: string;
  error?: string;
}

export async function activateLicense(input: ActivateInput): Promise<ActivateResult> {
  try {
    const res = await fetch(`${API_BASE}/api/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_key: input.licenseKey,
        product: input.product,
        domain: input.domain,
      }),
    });

    const data = await res.json().catch(() => ({})) as { valid?: boolean; jwt?: string; error?: string };
    if (data?.valid && data?.jwt) {
      const payload = await verifyJwt(data.jwt, input.product);
      if (!payload) {
        return { valid: false, error: "Received JWT failed signature verification" };
      }
      saveStored({ jwt: data.jwt, payload, invalid_since: null, last_heartbeat: new Date().toISOString() });
      return { valid: true, jwt: data.jwt };
    }
    return { valid: false, error: data?.error || "Activation failed" };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function heartbeat(): Promise<boolean> {
  const stored = loadStored();
  if (!stored) return false;

  try {
    const res = await fetch(`${API_BASE}/api/license/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt: stored.jwt }),
    });
    const data = await res.json().catch(() => ({})) as { valid?: boolean; jwt?: string; error?: string };
    if (data?.valid && data?.jwt) {
      const payload = await verifyJwt(data.jwt, stored.payload.product);
      if (payload) {
        saveStored({ jwt: data.jwt, payload, invalid_since: null, last_heartbeat: new Date().toISOString() });
        return true;
      }
    }
    // Invalid response — mark as failing
    if (!stored.invalid_since) {
      saveStored({ ...stored, invalid_since: new Date().toISOString() });
    }
    return false;
  } catch {
    // Network error — don't penalize immediately, just update heartbeat
    return false;
  }
}

// =============================================================================
// High-level state machine
// =============================================================================
export type LicenseState =
  | { status: "missing" }                              // no license yet — show setup wizard
  | { status: "active"; payload: LicensePayload }       // all good
  | { status: "grace"; payload: LicensePayload; daysLeft: number; reason: string }  // failing but in grace period
  | { status: "degraded"; payload: LicensePayload; reason: string }  // grace expired, soft-kill in progress
  | { status: "invalid"; reason: string };              // fully invalid, hard kill

const GRACE_PERIOD_DAYS = 7;   // After invalid_since, this many days of full features
const SOFT_KILL_DAYS = 30;     // After this many days from invalid_since → fully blocked

export async function getLicenseState(product: string): Promise<LicenseState> {
  const stored = loadStored();
  if (!stored) return { status: "missing" };

  // Verify JWT signature
  const payload = await verifyJwt(stored.jwt, product);
  if (!payload) {
    return { status: "invalid", reason: "JWT signature invalid or expired" };
  }

  // Check exp
  if (payload.exp * 1000 < Date.now()) {
    return { status: "invalid", reason: "JWT expired" };
  }

  // Check if marked as failing on previous heartbeats
  if (stored.invalid_since) {
    const since = new Date(stored.invalid_since).getTime();
    const elapsed = (Date.now() - since) / (1000 * 60 * 60 * 24);
    if (elapsed < GRACE_PERIOD_DAYS) {
      return {
        status: "grace",
        payload,
        daysLeft: Math.ceil(GRACE_PERIOD_DAYS - elapsed),
        reason: "License verification has been failing — re-check your subscription"
      };
    }
    if (elapsed < SOFT_KILL_DAYS) {
      return {
        status: "degraded",
        payload,
        reason: `License has been invalid for ${Math.ceil(elapsed)} days — features will progressively degrade`
      };
    }
    return { status: "invalid", reason: "Soft-kill period exhausted" };
  }

  return { status: "active", payload };
}

export async function isLicensed(product: string): Promise<boolean> {
  const state = await getLicenseState(product);
  return state.status === "active" || state.status === "grace";
}

// =============================================================================
// Soft-kill effects (templates can wire these into UI as desired)
// =============================================================================
export interface SoftKillEffects {
  /** Show a small warning banner */
  showWarning: boolean;
  /** Inject a watermark visible to end users */
  showWatermark: boolean;
  /** Randomly slow down some responses (50/50) */
  randomLatency: boolean;
  /** Randomly fail 30% of API calls */
  failRandomly: boolean;
  /** Block entirely */
  blockAll: boolean;
}

export function softKillEffects(state: LicenseState): SoftKillEffects {
  switch (state.status) {
    case "missing":
      return { showWarning: false, showWatermark: false, randomLatency: false, failRandomly: false, blockAll: true };
    case "active":
      return { showWarning: false, showWatermark: false, randomLatency: false, failRandomly: false, blockAll: false };
    case "grace":
      return { showWarning: true, showWatermark: false, randomLatency: false, failRandomly: false, blockAll: false };
    case "degraded":
      // Effects scale with elapsed time — caller can be smarter
      return { showWarning: true, showWatermark: true, randomLatency: true, failRandomly: true, blockAll: false };
    case "invalid":
      return { showWarning: true, showWatermark: true, randomLatency: false, failRandomly: false, blockAll: true };
  }
}

// =============================================================================
// Convenience wrappers
// =============================================================================
export function getProductFromEnv(fallback: string): string {
  return process.env.PCREATIVE_LICENSE_PRODUCT || fallback;
}

export function getDomainFromHost(hostHeader: string | null | undefined): string {
  if (process.env.PCREATIVE_LICENSE_DOMAIN) return process.env.PCREATIVE_LICENSE_DOMAIN;
  if (!hostHeader) return "localhost";
  return String(hostHeader).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").split(":")[0];
}
