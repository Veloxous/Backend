import { v4 as uuidv4 } from "uuid";
import {
  Transaction, Dispute, ReputationProfile,
  ReputationApiResponse, DeviceFingerprint,
} from "./types";
import { calculateTrustScore } from "./trust-score";
import { calculateSybilPenalty } from "./sybil-resistance";
import { DEFAULT_SCORING_CONFIG } from "./config";
