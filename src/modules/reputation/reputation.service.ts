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

export function addTransaction(tx: Transaction): void {
  const existing = transactions.get(tx.buyerId) || [];
  existing.push(tx);
  transactions.set(tx.buyerId, existing);

  const sellerTx = transactions.get(tx.sellerId) || [];
  sellerTx.push(tx);
  transactions.set(tx.sellerId, sellerTx);
}

export function addDispute(dispute: Dispute): void {
  const existing = disputes.get(dispute.respondentId) || [];
  existing.push(dispute);
  disputes.set(dispute.respondentId, existing);
}

export function addFingerprint(fp: DeviceFingerprint): void {
  const existing = fingerprints.get(fp.userId) || [];
  existing.push(fp);
  fingerprints.set(fp.userId, existing);
}
