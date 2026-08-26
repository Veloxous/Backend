import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
}

/**
 * Thin wrapper around the SMTP transporter — the seam that tests mock out
 * instead of asserting against nodemailer internals directly.
 */
export const EmailProvider = {
  async send({ to, subject, html }: SendEmailInput): Promise<void> {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "no-reply@veloxous.com",
      to,
      subject,
      html,
    });
  },
};
