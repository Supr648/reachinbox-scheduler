import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const encryptionKey = () => createHash("sha256")
  .update(process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET || "local-development-only")
  .digest();

export const encryptSecret = (value: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
};

export const decryptSecret = (value: string) => {
  if (!value.startsWith("enc:v1:")) return value;
  const [, , ivHex, tagHex, encryptedHex] = value.split(":");
  if (!ivHex || !tagHex || !encryptedHex) throw new Error("Invalid encrypted secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
};
