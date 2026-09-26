/**
 * sms.service.js
 * Sends real SMS messages via Twilio.
 * Falls back to console-only logging in demo/dev mode (when no Twilio creds are set).
 */

const { twilioAccountSid, twilioAuthToken, twilioPhoneNumber } = require("../config/env");

let twilioClient = null;

// Lazily initialise Twilio client only when creds exist
function getClient() {
  if (twilioClient) return twilioClient;

  if (!twilioAccountSid || !twilioAuthToken) {
    return null;
  }

  try {
    // eslint-disable-next-line global-require
    const twilio = require("twilio");
    twilioClient = twilio(twilioAccountSid, twilioAuthToken);
    return twilioClient;
  } catch (err) {
    console.warn("[SMS] Twilio module load failed:", err.message);
    return null;
  }
}

/**
 * sendOtp - Sends a 6-digit verification code to a phone number via SMS.
 *
 * @param {string} toPhone   - Destination phone number in E.164 format (e.g. "+923001234567")
 * @param {string} code      - 6-digit OTP string
 * @param {string} appName   - App name to include in the message body
 * @returns {Promise<{sent: boolean, demo: boolean}>}
 *   sent=true  → message dispatched to Twilio
 *   demo=true  → no Twilio creds; code was only logged to console
 */
async function sendOtp(toPhone, code, appName = "Live Session Toolkit") {
  const client = getClient();

  const messageBody = `${appName}: Your verification code is ${code}. It expires in 10 minutes. Do not share it with anyone.`;

  if (!client) {
    // ── DEMO / DEV MODE ──────────────────────────────────────────────────────
    console.log(`\n[SMS DEMO] ─────────────────────────────────────────────`);
    console.log(`[SMS DEMO] To:      ${toPhone}`);
    console.log(`[SMS DEMO] Code:    ${code}`);
    console.log(`[SMS DEMO] Message: ${messageBody}`);
    console.log(`[SMS DEMO] ─────────────────────────────────────────────\n`);
    console.log("[SMS DEMO] Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env to send real SMS.");
    return { sent: false, demo: true };
  }

  // ── LIVE SMS via Twilio ───────────────────────────────────────────────────
  if (!twilioPhoneNumber) {
    console.error("[SMS] TWILIO_PHONE_NUMBER is not set. Cannot send SMS.");
    return { sent: false, demo: false, error: "TWILIO_PHONE_NUMBER not configured" };
  }

  try {
    const message = await client.messages.create({
      body: messageBody,
      from: twilioPhoneNumber,
      to: toPhone,
    });
    console.log(`[SMS] OTP sent to ${toPhone} | SID: ${message.sid}`);
    return { sent: true, demo: false, sid: message.sid };
  } catch (err) {
    console.error(`[SMS] Failed to send OTP to ${toPhone}:`, err.message);
    throw err; // Let controller handle the error
  }
}

module.exports = { sendOtp };
