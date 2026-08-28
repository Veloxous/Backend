import { renderLayout, button, BRAND_COLORS } from "./brand";

export interface ReputationTierChangedPayload {
  previousTier: string;
  newTier: string;
  trustScore?: number;
  profileUrl?: string;
}

export function render(payload: ReputationTierChangedPayload): { subject: string; html: string } {
  const { previousTier, newTier, trustScore, profileUrl } = payload;

  const bodyHtml = `
    <p>Your reputation tier has changed from <strong>${previousTier}</strong> to <strong style="color:${BRAND_COLORS.emeraldTechDark};">${newTier}</strong>.</p>
    ${
      trustScore !== undefined
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0; border:1px solid ${BRAND_COLORS.border}; border-radius:6px;">
      <tr>
        <td style="padding:12px 16px; font-size:13px; color:${BRAND_COLORS.textMuted};">Current Trust Score</td>
        <td style="padding:12px 16px; font-size:13px; text-align:right;">${trustScore}</td>
      </tr>
    </table>`
        : ""
    }
    <p>Keep up the great activity on Veloxous — your tier reflects your track record with the community.</p>
    ${profileUrl ? button("View Your Profile", profileUrl) : ""}
  `;

  return {
    subject: `Your Veloxous reputation tier is now ${newTier}`,
    html: renderLayout({
      heading: "Reputation Tier Changed",
      preheader: `You're now ${newTier} tier.`,
      bodyHtml,
    }),
  };
}
