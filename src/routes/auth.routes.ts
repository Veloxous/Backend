import { Router } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import jwt from "jsonwebtoken";

const router = Router();

// Configuration
// In production, these should be properly loaded from environment variables
const SERVER_SECRET_KEY = process.env.ADMIN_SECRET_KEY || StellarSdk.Keypair.random().secret();
export const SERVER_KEYPAIR = StellarSdk.Keypair.fromSecret(SERVER_SECRET_KEY);
const HOME_DOMAIN = process.env.FRONTEND_URL ? new URL(process.env.FRONTEND_URL).hostname : "localhost";
const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_change_me_in_prod";
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === "mainnet" 
    ? StellarSdk.Networks.PUBLIC 
    : StellarSdk.Networks.TESTNET;

import { pool } from "../db/db";

// Simple in-memory rate limiter for GET /auth per IP
const getChallengeLimiter = new Map<string, { count: number, resetAt: number }>();
// Periodic cleanup of expired challenges
const cleanupTimer = setInterval(() => {
    pool.query("DELETE FROM auth_challenges WHERE expires_at <= NOW()").catch(console.error);
}, 60000); // 1 minute
if (cleanupTimer.unref) cleanupTimer.unref();

// GET /auth
// Generates a SEP-10 challenge transaction
router.get("/", async (req, res) => {
    try {
        const account = req.query.account as string;
        
        if (!account) {
            return res.status(400).json({ error: "Missing 'account' query parameter" });
        }

        // Validate the account ID
        if (!StellarSdk.StrKey.isValidEd25519PublicKey(account)) {
            return res.status(400).json({ error: "Invalid 'account' parameter" });
        }

        const clientIp = req.ip || req.connection?.remoteAddress || "unknown";
        const now = Date.now();
        const limitRecord = getChallengeLimiter.get(clientIp);
        if (limitRecord && limitRecord.resetAt > now) {
            if (limitRecord.count >= 10) {
                return res.status(429).json({ error: "Too many challenge requests" });
            }
            limitRecord.count++;
        } else {
            getChallengeLimiter.set(clientIp, { count: 1, resetAt: now + 60000 });
        }

        // Generate challenge transaction valid for 15 minutes
        const challenge = StellarSdk.WebAuth.buildChallengeTx(
            SERVER_KEYPAIR,
            account,
            HOME_DOMAIN,
            900, // 15 minutes
            NETWORK_PASSPHRASE,
            HOME_DOMAIN
        );

        const tx = new StellarSdk.Transaction(challenge, NETWORK_PASSPHRASE);
        const txHash = tx.hash().toString("hex");

        await pool.query(
            "INSERT INTO auth_challenges (hash, expires_at) VALUES ($1, NOW() + INTERVAL '15 minutes')",
            [txHash]
        );

        res.json({ 
            transaction: challenge,
            network_passphrase: NETWORK_PASSPHRASE 
        });
    } catch (error: any) {
        console.error("[GET /auth] Error building challenge tx:", error);
        res.status(500).json({ error: "Failed to generate challenge transaction" });
    }
});

const failedAuthLimiter = new Map<string, { count: number, resetAt: number }>();
function handleAuthFailure(res: any, ip: string, status: number, reason: string) {
    const now = Date.now();
    const record = failedAuthLimiter.get(ip);
    if (record && record.resetAt > now) {
        record.count++;
    } else {
        failedAuthLimiter.set(ip, { count: 1, resetAt: now + 300000 });
    }
    console.warn(JSON.stringify({ event: "auth_failure", reason, ip }));
    return res.status(status).json({ error: reason });
}

const HORIZON_URL = process.env.STELLAR_NETWORK === "mainnet" 
    ? "https://horizon.stellar.org" 
    : "https://horizon-testnet.stellar.org";
const stellarServer = new StellarSdk.Horizon.Server(HORIZON_URL);

// POST /auth
// Verifies a signed SEP-10 challenge transaction and issues a JWT
router.post("/", async (req, res) => {
    const clientIp = req.ip || req.connection?.remoteAddress || "unknown";
    try {
        const now = Date.now();
        const record = failedAuthLimiter.get(clientIp);
        if (record && record.resetAt > now && record.count >= 5) {
            return res.status(429).json({ error: "Too many failed attempts. Try again later." });
        }

        const { transaction } = req.body;

        if (!transaction) {
            return handleAuthFailure(res, clientIp, 400, "Missing 'transaction' in request body");
        }

        // Read the challenge transaction
        const challengeTx = StellarSdk.WebAuth.readChallengeTx(
            transaction,
            SERVER_KEYPAIR.publicKey(),
            NETWORK_PASSPHRASE,
            HOME_DOMAIN,
            HOME_DOMAIN
        );

        // Determine the client account ID from the transaction
        const clientAccountId = challengeTx.clientAccountID;

        // Fetch account signer summary from Horizon
        const accountRecord = await stellarServer.loadAccount(clientAccountId);

        // Verify the client's signature
        const signers = StellarSdk.WebAuth.verifyChallengeTxThreshold(
            transaction,
            SERVER_KEYPAIR.publicKey(),
            NETWORK_PASSPHRASE,
            accountRecord.thresholds.low_threshold, // threshold
            accountRecord.signers, // signerSummary
            HOME_DOMAIN,
            HOME_DOMAIN
        );

        if (!signers || signers.length === 0) {
            return handleAuthFailure(res, clientIp, 401, "Invalid transaction signature or missing threshold");
        }

        const txHash = challengeTx.tx.hash().toString("hex");

        // Atomically consume it
        const consumeResult = await pool.query(
            "DELETE FROM auth_challenges WHERE hash = $1 AND expires_at > NOW() RETURNING *",
            [txHash]
        );

        if (consumeResult.rowCount === 0) {
            return handleAuthFailure(res, clientIp, 401, "Challenge expired, invalid, or already consumed");
        }

        // Generate JWT
        const token = jwt.sign(
            { sub: clientAccountId },
            JWT_SECRET,
            { expiresIn: "24h" }
        );

        res.json({ token });
    } catch (error: any) {
        console.error("[POST /auth] Error verifying challenge tx:", error);
        return handleAuthFailure(res, clientIp, 401, "Authentication failed. " + (error.message || ""));
    }
});

export default router;
