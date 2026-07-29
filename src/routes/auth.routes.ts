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

// GET /auth
// Generates a SEP-10 challenge transaction
router.get("/", (req, res) => {
    try {
        const account = req.query.account as string;
        
        if (!account) {
            return res.status(400).json({ error: "Missing 'account' query parameter" });
        }

        // Validate the account ID
        if (!StellarSdk.StrKey.isValidEd25519PublicKey(account)) {
            return res.status(400).json({ error: "Invalid 'account' parameter" });
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

        res.json({ transaction: challenge });
    } catch (error: any) {
        console.error("[GET /auth] Error building challenge tx:", error);
        res.status(500).json({ error: "Failed to generate challenge transaction" });
    }
});

// POST /auth
// Verifies a signed SEP-10 challenge transaction and issues a JWT
router.post("/", (req, res) => {
    try {
        const { transaction } = req.body;

        if (!transaction) {
            return res.status(400).json({ error: "Missing 'transaction' in request body" });
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

        // Verify the client's signature
        const signers = StellarSdk.WebAuth.verifyChallengeTxSigners(
            transaction,
            SERVER_KEYPAIR.publicKey(),
            NETWORK_PASSPHRASE,
            [clientAccountId], // signers to check
            HOME_DOMAIN,
            HOME_DOMAIN
        );

        if (!signers.includes(clientAccountId)) {
            return res.status(401).json({ error: "Invalid transaction signature" });
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
        res.status(401).json({ error: "Authentication failed. " + (error.message || "") });
    }
});

export default router;
