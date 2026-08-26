import { renderLayout, button, BRAND_COLORS } from "./brand";

export interface ItemShippedPayload {
  itemTitle?: string;
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
}

export function render(payload: ItemShippedPayload): { subject: string; html: string } {
  const { itemTitle, trackingNumber, carrier, trackingUrl } = payload;

  const bodyHtml = `
    <p>${itemTitle ? `<strong>${itemTitle}</strong> is` : "Your item is"} on its way.</p>
    ${
      trackingNumber
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0; border:1px solid ${BRAND_COLORS.border}; border-radius:6px;">
      <tr>
        <td style="padding:12px 16px; font-size:13px; color:${BRAND_COLORS.textMuted};">Tracking Number</td>
        <td style="padding:12px 16px; font-size:13px; text-align:right; font-family:monospace;">${trackingNumber}</td>
      </tr>
      ${
        carrier
          ? `<tr>
        <td style="padding:12px 16px; font-size:13px; color:${BRAND_COLORS.textMuted}; border-top:1px solid ${BRAND_COLORS.border};">Carrier</td>
        <td style="padding:12px 16px; font-size:13px; text-align:right; border-top:1px solid ${BRAND_COLORS.border};">${carrier}</td>
      </tr>`
          : ""
      }
    </table>`
        : ""
    }
    ${trackingUrl ? button("Track Shipment", trackingUrl) : ""}
  `;

  return {
    subject: "Your item has shipped",
    html: renderLayout({
      heading: "Item Shipped",
      preheader: "Your item is on its way.",
      bodyHtml,
    }),
  };
}
