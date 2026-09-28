import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidEmailAddress,
  makeIdempotencyKey,
  normalizeRecipients,
  scheduledTimeForRecipient,
} from "./scheduling";

test("normalizes and deduplicates recipient addresses", () => {
  assert.deepEqual(
    normalizeRecipients(["  Ada@Example.com ", "ada@example.com", "", null]),
    ["ada@example.com"],
  );
});

test("validates recipient email addresses", () => {
  assert.equal(isValidEmailAddress("person@example.com"), true);
  assert.equal(isValidEmailAddress("not-an-address"), false);
});

test("spaces recipient times from the requested campaign start", () => {
  const startAt = new Date("2026-09-28T12:00:00.000Z");
  assert.equal(scheduledTimeForRecipient(startAt, 3, 2).toISOString(), "2026-09-28T12:00:06.000Z");
});

test("creates stable, recipient-specific idempotency keys", () => {
  const key = makeIdempotencyKey("user-1", "request-1", "ada@example.com");
  assert.equal(makeIdempotencyKey("user-1", "request-1", "ada@example.com"), key);
  assert.notEqual(makeIdempotencyKey("user-1", "request-1", "grace@example.com"), key);
});