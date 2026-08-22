import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = new Resend(env.RESEND_API_KEY);

const FROM = "Zupiq <support@zupiq.ai>";
const SUPPORT_EMAIL = "support@zupiq.ai";

// ─── Shared layout ────────────────────────────────────────────────────────────

function layout(body: string, footerNote: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zupiq</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px 40px;">

    <!-- Logo -->
    <div style="margin-bottom:36px;">
      <span style="font-size:20px;font-weight:700;color:#2f6bff;letter-spacing:-0.5px;">zupiq</span>
    </div>

    <!-- Body -->
    ${body}

    <!-- Footer -->
    <div style="margin-top:40px;padding-top:24px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.7;">
        © 2026 Zupiq. All rights reserved.<br />
        ${footerNote}
      </p>
    </div>

  </div>
</body>
</html>`;
}

// ─── Welcome email ────────────────────────────────────────────────────────────

function welcomeHtml(name: string): string {
  const firstName = name.split(" ")[0];
  return layout(
    `<h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#111827;letter-spacing:-0.4px;line-height:1.2;">Welcome to Zupiq</h1>

    <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.7;">Hi ${firstName},</p>
    <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
      Thanks for joining Zupiq! We're excited to have you with us.<br />
      Zupiq is here to help you learn math smarter, practice more effectively, and build your confidence every day.
    </p>

    <a href="${env.APP_URL}" style="display:inline-block;background:#2f6bff;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:11px 22px;border-radius:8px;">
      Get Started
    </a>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:36px 0;" />

    <p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#111827;">Everything you need, in one place</p>
    <p style="margin:0 0 32px;font-size:14px;color:#6b7280;line-height:1.7;">
      Solve problems, get step-by-step explanations, and track your progress — all in Zupiq.
    </p>

    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
      Cheers,<br />
      <span style="font-weight:600;color:#2f6bff;">The Zupiq Team</span>
    </p>`,
    "You're receiving this because you created a Zupiq account. If that wasn't you, you can safely ignore this email."
  );
}

// ─── Password reset email ─────────────────────────────────────────────────────

function passwordResetHtml(name: string, code: string): string {
  const firstName = name.split(" ")[0];
  return layout(
    `<h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#111827;letter-spacing:-0.4px;line-height:1.2;">Reset your password</h1>

    <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.7;">Hi ${firstName},</p>
    <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
      We received a request to reset your Zupiq password. Enter the code below in the app to continue. This code expires in <strong>10 minutes</strong>.
    </p>

    <div style="margin:0 0 28px;padding:24px;background:#f5f8ff;border-radius:12px;text-align:center;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;">Your reset code</p>
      <p style="margin:0;font-size:40px;font-weight:700;color:#2f6bff;letter-spacing:0.15em;">${code}</p>
    </div>

    <p style="margin:0 0 32px;font-size:13px;color:#6b7280;line-height:1.6;">
      If you didn't request a password reset, you can safely ignore this email — your password won't change.
    </p>

    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
      Cheers,<br />
      <span style="font-weight:600;color:#2f6bff;">The Zupiq Team</span>
    </p>`,
    "You're receiving this because a password reset was requested for your Zupiq account."
  );
}

// ─── Account deletion confirmation email (to user) ────────────────────────────

function accountDeletionUserHtml(name: string): string {
  const firstName = name.split(" ")[0];
  return layout(
    `<h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#111827;letter-spacing:-0.4px;line-height:1.2;">Account deletion request received</h1>

    <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.7;">Hi ${firstName},</p>
    <p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.7;">
      We've received your request to delete your Zupiq account. Our team will review and process it within the period required by applicable law.
    </p>
    <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
      We may need to verify your identity before completing the deletion to protect your account from unauthorized requests.
    </p>

    <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#111827;">What happens next</p>
    <ul style="margin:0 0 28px;padding-left:18px;font-size:14px;color:#6b7280;line-height:1.9;">
      <li>We'll verify your identity if needed</li>
      <li>Your account and associated data will be deleted or anonymized</li>
      <li>Once deleted, your data cannot be recovered</li>
      <li>Any active subscription must be cancelled separately through the App Store or Google Play</li>
    </ul>

    <p style="margin:0 0 32px;font-size:14px;color:#374151;line-height:1.7;">
      If you have questions or changed your mind, reply to this email or contact
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#2f6bff;text-decoration:none;">${SUPPORT_EMAIL}</a>.
    </p>

    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;">
      Cheers,<br />
      <span style="font-weight:600;color:#2f6bff;">The Zupiq Team</span>
    </p>`,
    "You're receiving this because you submitted an account deletion request for your Zupiq account."
  );
}

// ─── Account deletion admin notification ─────────────────────────────────────

function accountDeletionAdminHtml(email: string, reason?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<body style="font-family:sans-serif;padding:24px;color:#111827;">
  <h2 style="margin:0 0 16px;">Account Deletion Request</h2>
  <p><strong>Email:</strong> ${email}</p>
  ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
  <p style="color:#6b7280;font-size:13px;">Submitted via the Zupiq delete-account page. Verify identity before processing.</p>
</body>
</html>`;
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM,
    to: [to],
    subject: "Welcome to Zupiq",
    html: welcomeHtml(name),
  });

  if (error) {
    console.error("[email] sendWelcomeEmail error:", error);
  }
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  code: string
): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM,
    to: [to],
    subject: `${code} is your Zupiq reset code`,
    html: passwordResetHtml(name, code),
  });

  if (error) {
    console.error("[email] sendPasswordResetEmail error:", error);
    throw new Error("Failed to send password reset email");
  }
}

export async function sendAccountDeletionEmails(
  userEmail: string,
  userName: string,
  reason?: string
): Promise<void> {
  const userResult = await resend.emails.send({
    from: FROM,
    to: [userEmail],
    subject: "We received your account deletion request",
    html: accountDeletionUserHtml(userName),
  });

  const adminResult = await resend.emails.send({
    from: FROM,
    to: [SUPPORT_EMAIL],
    replyTo: userEmail,
    subject: `Account Deletion Request — ${userEmail}`,
    html: accountDeletionAdminHtml(userEmail, reason),
    text: ["Account Deletion Request", "", `Email: ${userEmail}`, reason ? `Reason: ${reason}` : ""]
      .filter(Boolean)
      .join("\n"),
  });

  if (userResult.error) console.error("[email] deletion user email error:", userResult.error);
  if (adminResult.error) console.error("[email] deletion admin email error:", adminResult.error);
}
