import { renderLayout, button, BRAND_COLORS } from "./brand";

export interface DisputeRaisedPayload {
  transactionId: string;
  reason?: string;
  itemTitle?: string;
  disputeUrl?: string;
}

export function render(payload: DisputeRaisedPayload): { subject: string; html: string } {
  const { transactionId, reason, itemTitle, disputeUrl } = payload;

  const bodyHtml = `
    <p>A dispute has been raised${itemTitle ? ` for <strong>${itemTitle}</strong>` : ""} and requires your attention.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0; border:1px solid ${BRAND_COLORS.border}; border-radius:6px;">
      <tr>
        <td style="padding:12px 16px; font-size:13px; color:${BRAND_COLORS.textMuted};">Transaction ID</td>
        <td style="padding:12px 16px; font-size:13px; text-align:right; font-family:monospace;">${transactionId}</td>
      </tr>
      ${
        reason
          ? `<tr>
        <td style="padding:12px 16px; font-size:13px; color:${BRAND_COLORS.textMuted}; border-top:1px solid ${BRAND_COLORS.border};">Reason</td>
        <td style="padding:12px 16px; font-size:13px; text-align:right; border-top:1px solid ${BRAND_COLORS.border};">${reason}</td>
      </tr>`
          : ""
      }
    </table>
    <p>Please review the details and respond as soon as possible so this can be resolved fairly.</p>
    ${disputeUrl ? button("Review Dispute", disputeUrl) : ""}
  `;

  return {
    subject: "Dispute Raised — Action needed",
    html: renderLayout({
      heading: "Dispute Raised",
      preheader: "A dispute needs your attention.",
      bodyHtml,
    }),
  };
}
