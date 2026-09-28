import nodemailer from "nodemailer";

async function generateCredentials() {
  try {
    const testAccount = await nodemailer.createTestAccount();
    console.log("\n--- Ethereal Test Credentials Generated ---");
    console.log("SMTP Host: " + testAccount.smtp.host);
    console.log("SMTP Port: " + testAccount.smtp.port);
    console.log("User: " + testAccount.user);
    console.log("Pass: " + testAccount.pass);
    console.log("------------------------------------------\n");
  } catch (error) {
    console.error("Failed to generate Ethereal credentials:", error);
  }
}

generateCredentials();
