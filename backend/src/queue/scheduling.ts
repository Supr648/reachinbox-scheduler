import { createHash } from "node:crypto";

export const normalizeRecipients = (values: unknown[]) => Array.from(new Set(
  values
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.length > 0),
));

export const isValidEmailAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const scheduledTimeForRecipient = (startAt: Date, index: number, delaySeconds: number) =>
  new Date(startAt.getTime() + index * delaySeconds * 1000);

export const makeIdempotencyKey = (userId: string, requestKey: string, recipient: string) =>
  createHash("sha256").update(`${userId}:${requestKey}:${recipient}`).digest("hex");

export const interpolateTemplate = (template: string, variables: Record<string, string>) =>
  template.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/gi, (_, key) => variables[key.toLowerCase()] ?? `{{${key}}}`);