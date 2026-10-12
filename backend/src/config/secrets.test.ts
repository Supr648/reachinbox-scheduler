import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret } from "./secrets";

test("encrypts and decrypts a plain text secret correctly", () => {
  const original = "my-super-secret-smtp-password-1234!";
  const encrypted = encryptSecret(original);
  assert.notEqual(encrypted, original);
  assert.match(encrypted, /^enc:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+/);
  const decrypted = decryptSecret(encrypted);
  assert.equal(decrypted, original);
});

test("encrypts and decrypts unicode and special characters", () => {
  const original = "p@$$w0rd_with_unicode_🚀_!#%&*()[]{}";
  const encrypted = encryptSecret(original);
  const decrypted = decryptSecret(encrypted);
  assert.equal(decrypted, original);
});

test("handles unencrypted legacy secrets transparently", () => {
  const plain = "unencrypted_legacy_password";
  assert.equal(decryptSecret(plain), plain);
});

test("throws error when encrypted string format is corrupted", () => {
  assert.throws(() => {
    decryptSecret("enc:v1:badformat");
  }, /Invalid encrypted secret format/);
});
