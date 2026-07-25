import { v4 as uuidv4 } from "uuid";
import {
  Transaction, Dispute, ReputationProfile,
  ReputationApiResponse, DeviceFingerprint,
} from "./types";
import { calculateTrustScore } from "./trust-score";
import { calculateSybilPenalty } from "./sybil-resistance";
import { DEFAULT_SCORING_CONFIG } from "./config";

const profiles = new Map<string, ReputationProfile>();
const transactions = new Map<string, Transaction[]>();
const disputes = new Map<string, Dispute[]>();
const fingerprints = new Map<string, DeviceFingerprint[]>();

export function resetStore(): void {
  profiles.clear();
  transactions.clear();
  disputes.clear();
  fingerprints.clear();
}
