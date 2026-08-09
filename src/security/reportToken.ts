import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SealedReportPayload } from "../types.js";

const TOKEN_VERSION = "v1";
const REPORT_TTL_SECONDS = 30 * 24 * 60 * 60;

export function sealReport(
  key: Buffer,
  payload: Omit<SealedReportPayload, "exp">,
  now = Date.now(),
): { token: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + REPORT_TTL_SECONDS;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(TOKEN_VERSION));
  const plaintext = Buffer.from(JSON.stringify({ ...payload, exp }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    token: [TOKEN_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join("."),
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function openReport(key: Buffer, token: string, now = Date.now()): SealedReportPayload {
  const [version, ivPart, tagPart, ciphertextPart, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !ivPart || !tagPart || !ciphertextPart || extra) {
    throw new Error("Invalid report token.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    decipher.setAAD(Buffer.from(TOKEN_VERSION));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext) as SealedReportPayload;
    if (!payload.calculator || !payload.methodology_version || !payload.input || !Number.isFinite(payload.exp)) {
      throw new Error("Invalid report payload.");
    }
    if (payload.exp * 1000 <= now) {
      const error = new Error("Report token has expired.");
      error.name = "ExpiredReportError";
      throw error;
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "ExpiredReportError") throw error;
    throw new Error("Invalid report token.");
  }
}
