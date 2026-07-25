import { onTierChange, TierChangeEvent } from "./reputation.service";

export function sendTierChangeNotification(event: TierChangeEvent): void {
  const tierMessages: Record<string, string> = {
    elite: "Congratulations! You've achieved Elite status with a trust score of",
    suspended: "Your account has been suspended due to a low trust score of",
    standard: "Your account status has changed to Standard with a trust score of",
  };

  const message = `${tierMessages[event.newTier]} ${event.trustScore}.`;
  console.log(`[notification] Tier change for ${event.userId}: ${message}`);
}

export function registerNotificationHandlers(): void {
  onTierChange(sendTierChangeNotification);
}
