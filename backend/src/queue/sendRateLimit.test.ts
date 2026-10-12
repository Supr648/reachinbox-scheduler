import assert from "node:assert/strict";
import test from "node:test";
import { reserveSendSlot } from "./sendRateLimit";
import { redisConnection } from "../config/redis";

test("reserveSendSlot allows the first send without delay", async () => {
  const testKey = `test-sender-first-${Date.now()}`;
  const res = await reserveSendSlot(testKey, 100, 2000);
  assert.equal(res.delayMs, 0);
  assert.equal(res.hourlyLimitHit, false);
});

test("reserveSendSlot enforces minDelay between consecutive sends", async () => {
  const testKey = `test-sender-delay-${Date.now()}`;
  const res1 = await reserveSendSlot(testKey, 100, 3000);
  assert.equal(res1.delayMs, 0);
  assert.equal(res1.hourlyLimitHit, false);

  const res2 = await reserveSendSlot(testKey, 100, 3000);
  assert.ok(res2.delayMs > 0, "Expected a delay between consecutive sends");
  assert.equal(res2.hourlyLimitHit, false);
});

test("reserveSendSlot enforces hourlyLimit", async () => {
  const testKey = `test-sender-cap-${Date.now()}`;
  const res1 = await reserveSendSlot(testKey, 1, 0);
  assert.equal(res1.delayMs, 0);
  assert.equal(res1.hourlyLimitHit, false);

  const res2 = await reserveSendSlot(testKey, 1, 0);
  assert.ok(res2.delayMs > 0, "Expected a delay when hourly cap is reached");
  assert.equal(res2.hourlyLimitHit, true);
});

test.after(async () => {
  await redisConnection.quit();
});
