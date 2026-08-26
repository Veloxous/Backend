// Shared Veloxous email layout: "Deep Navy" + "Emerald Tech" brand palette.

export const BRAND_COLORS = {
  deepNavy: "#0B1B33",
  deepNavyLight: "#132A4D",
  emeraldTech: "#00C48C",
  emeraldTechDark: "#00A876",
  textOnNavy: "#F5F7FA",
  textMuted: "#8FA0B8",
  bodyText: "#1F2937",
  border: "#E2E8F0",
};

export interface EmailLayoutOptions {
  preheader?: string;
  heading: string;
  bodyHtml: string;
}

/**
 * Wraps template-specific content in the shared Veloxous header/footer shell.
 * Kept as inline styles throughout — required for reliable rendering across
 * email clients, which strip <style> blocks and most CSS selectors.
 */
export function renderLayout({ preheader, heading, bodyHtml }: EmailLayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${heading}</title>
  </head>
  <body style="margin:0; padding:0; background-color:${BRAND_COLORS.border}; font-family:'Helvetica Neue', Arial, sans-serif;">
    ${preheader ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND_COLORS.border}; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF; border-radius:8px; overflow:hidden; max-width:600px; width:100%;">
            <tr>
              <td style="background-color:${BRAND_COLORS.deepNavy}; padding:24px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="color:${BRAND_COLORS.textOnNavy}; font-size:20px; font-weight:700; letter-spacing:0.5px;">
                      VELOXOUS
                    </td>
                    <td align="right">
                      <span style="display:inline-block; background-color:${BRAND_COLORS.emeraldTech}; color:${BRAND_COLORS.deepNavy}; font-size:11px; font-weight:700; letter-spacing:0.5px; padding:4px 10px; border-radius:999px; text-transform:uppercase;">
                        Notification
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px; color:${BRAND_COLORS.deepNavy}; font-size:22px; line-height:1.3;">
                  ${heading}
                </h1>
                <div style="color:${BRAND_COLORS.bodyText}; font-size:15px; line-height:1.6;">
                  ${bodyHtml}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:${BRAND_COLORS.deepNavyLight}; border-top:3px solid ${BRAND_COLORS.emeraldTech};">
                <p style="margin:0; color:${BRAND_COLORS.textMuted}; font-size:12px; line-height:1.5;">
                  This is an automated notification from Veloxous. If you weren't expecting this, you can safely ignore it.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background-color:${BRAND_COLORS.emeraldTech}; border-radius:6px;">
        <a href="${url}" style="display:inline-block; padding:12px 24px; color:${BRAND_COLORS.deepNavy}; font-size:14px; font-weight:700; text-decoration:none;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}
