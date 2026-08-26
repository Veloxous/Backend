import { renderLayout, button, BRAND_COLORS } from "./brand";

export interface EscrowFundedPayload {
  transactionId: string;
  amount?: string;
  itemTitle?: string;
  swapUrl?: string;
}

export function render(payload: EscrowFundedPayload): { subject: string; html: string } {
  const { transactionId, amount, itemTitle, swapUrl } = payload;

  const bodyHtml = `
    <p>Good news — escrow has been funded${itemTitle ? ` for <strong>${itemTitle}</strong>` : ""}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0; border:1px solid ${BRAND_COLORS.border}; border-radius:6px;">
      <tr>
        <td style="padding:12px 16px; font-size:13px; color:${BRAND_COLORS.textMuted};">Transaction ID</td>
        <td style="padding:12px 16px; font-size:13px; text-align:right; font-family:monospace;">${transactionId}</td>
      </tr>
      ${
        amount
          ? `<tr>
        <td style="padding:12px 16px; font-size:13px; color:${BRAND_COLORS.textMuted}; border-top:1px solid ${BRAND_COLORS.border};">Amount</td>
        <td style="padding:12px 16px; font-size:13px; text-align:right; border-top:1px solid ${BRAND_COLORS.border};">${amount}</td>
      </tr>`
          : ""
      }
    </table>
    <p>Your funds are safely held in escrow until the swap conditions are met.</p>
    ${swapUrl ? button("View Swap Details", swapUrl) : ""}
  `;

  return {
    subject: "Escrow Funded — Your swap is secured",
    html: renderLayout({
      heading: "Escrow Funded",
      preheader: "Your escrow deposit has been confirmed.",
      bodyHtml,
    }),
  };
}
