import { COMPANY } from "@/lib/company";

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /** Marketing emails need opt-in consent (GDPR/CASL) and an unsubscribe
   * link; transactional emails (receipts, cancellation confirmations,
   * password resets) are exempt from consent but still get the footer below
   * for consistency. */
  kind: "transactional" | "marketing";
}

// TODO: no email provider is specified in the build stack — wire this up to
// Resend (or whichever provider is chosen) by setting RESEND_API_KEY. Until
// then this logs instead of sending so the rest of the app (cancellation
// flow, contact form) can be built and exercised end-to-end without a
// provider account. Every call site already goes through this one function,
// so adding the real provider later is a one-file change.
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const footer = `
    <hr />
    <p style="font-size:12px;color:#8A8A96">
      ${COMPANY.legalName} · ${COMPANY.physicalAddress}
      ${params.kind === "marketing" ? ' · <a href="{{unsubscribe_url}}">Unsubscribe</a>' : ""}
    </p>
  `;
  const html = params.html + footer;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY not set — logging instead of sending to ${params.to}: ${params.subject}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `Velora Studio <${COMPANY.supportEmail}>`,
      to: params.to,
      subject: params.subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[email] send failed (${res.status}): ${body}`);
  }
}
