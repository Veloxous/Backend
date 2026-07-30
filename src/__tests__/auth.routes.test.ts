import express from "express";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";

process.env.JWT_SECRET = "test_jwt_secret";

const mockChallenges = new Map<string, boolean>();

jest.mock("../db/db", () => ({
    pool: {
        query: jest.fn().mockImplementation(async (query: string, params: any[]) => {
            if (query.includes("INSERT INTO auth_challenges")) {
                mockChallenges.set(params[0], true);
                return { rowCount: 1, rows: [] };
            } else if (query.includes("DELETE FROM auth_challenges")) {
                if (mockChallenges.has(params[0])) {
                    mockChallenges.delete(params[0]);
                    return { rowCount: 1, rows: [{ hash: params[0] }] };
                }
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 1, rows: [{}] };
        })
    }
}));

import authRouter, { SERVER_KEYPAIR, _testClearLimiters } from "../routes/auth.routes";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());
app.use("/auth", authRouter);

describe("SEP-10 Auth Routes", () => {
    const clientKeypair = StellarSdk.Keypair.random();
    const serverKeypair = SERVER_KEYPAIR;
    const networkPassphrase = process.env.STELLAR_NETWORK === "mainnet" 
        ? StellarSdk.Networks.PUBLIC 
        : StellarSdk.Networks.TESTNET;

    const buildFreshChallenge = () => {
        const challenge = StellarSdk.WebAuth.buildChallengeTx(
            SERVER_KEYPAIR,
            clientKeypair.publicKey(),
            "localhost",
            900, // 15 minutes
            networkPassphrase,
            "localhost"
        );
        const tx = new StellarSdk.Transaction(challenge, networkPassphrase);
        const txHash = tx.hash().toString("hex");
        mockChallenges.set(txHash, true);
        return challenge;
    };

    beforeAll(() => {
        jest.spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount").mockImplementation(async (accountId: string) => {
            if (accountId === "NON_EXISTENT") throw new StellarSdk.NotFoundError("Not found", {} as any);
            if (accountId === "HORIZON_ERROR") throw new Error("Horizon is down");
            
            return {
                id: accountId,
                signers: [{ key: accountId, weight: 1 }],
                thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 }
            } as any;
        });
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    it("should return a challenge transaction for a valid account", async () => {
        const response = await request(app)
            .get(`/auth?account=${clientKeypair.publicKey()}`)
            .expect(200);

        expect(response.body).toHaveProperty("transaction");
        const tx = StellarSdk.WebAuth.readChallengeTx(
            response.body.transaction,
            serverKeypair.publicKey(),
            networkPassphrase,
            "localhost",
            "localhost"
        );
        expect(tx.clientAccountID).toBe(clientKeypair.publicKey());
    });

    it("should verify a signed challenge and return a JWT", async () => {
        const challengeTransaction = buildFreshChallenge();
        const tx = new StellarSdk.Transaction(challengeTransaction, networkPassphrase);
        tx.sign(clientKeypair);
        const signedChallenge = tx.toXDR();

        const response = await request(app)
            .post("/auth")
            .send({ transaction: signedChallenge })
            .expect(200);

        expect(response.body).toHaveProperty("token");
        const verified = jwt.verify(response.body.token, process.env.JWT_SECRET!) as any;
        expect(verified.sub).toBe(clientKeypair.publicKey());
        expect(verified.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("should fail for a previously consumed challenge", async () => {
        const challengeTransaction = buildFreshChallenge();
        const tx = new StellarSdk.Transaction(challengeTransaction, networkPassphrase);
        tx.sign(clientKeypair);
        const signedChallenge = tx.toXDR();

        // Consume it once
        await request(app).post("/auth").send({ transaction: signedChallenge }).expect(200);

        // Try again
        const response = await request(app).post("/auth").send({ transaction: signedChallenge }).expect(401);
        expect(response.body.error).toContain("Challenge expired, invalid, or already consumed");
    });

    it("should fail for missing challenge in DB", async () => {
        const challengeTransaction = buildFreshChallenge();
        const tx = new StellarSdk.Transaction(challengeTransaction, networkPassphrase);
        tx.sign(clientKeypair);
        const signedChallenge = tx.toXDR();
        
        // Remove from DB manually
        const txHash = tx.hash().toString("hex");
        mockChallenges.delete(txHash);

        const response = await request(app).post("/auth").send({ transaction: signedChallenge }).expect(401);
        expect(response.body.error).toContain("Challenge expired, invalid, or already consumed");
    });

    it("should fail for forged signatures", async () => {
        const challengeTransaction = buildFreshChallenge();
        const tx = new StellarSdk.Transaction(challengeTransaction, networkPassphrase);
        const randomKeypair = StellarSdk.Keypair.random();
        tx.sign(randomKeypair); // wrong signature
        const signedChallenge = tx.toXDR();

        await request(app).post("/auth").send({ transaction: signedChallenge }).expect(401);
    });

    it("should fail for missing transaction", async () => {
        await request(app).post("/auth").send({}).expect(400);
    });

    it("should fail for a wrong-network transaction", async () => {
        const challengeTransaction = buildFreshChallenge();
        const wrongNetwork = StellarSdk.Networks.TESTNET === networkPassphrase 
            ? StellarSdk.Networks.PUBLIC 
            : StellarSdk.Networks.TESTNET;
        const tx = new StellarSdk.Transaction(challengeTransaction, wrongNetwork);
        tx.sign(clientKeypair);
        const signedChallenge = tx.toXDR();

        await request(app).post("/auth").send({ transaction: signedChallenge }).expect(401);
    });

    it("should apply failed-attempt rate limiting", async () => {
        _testClearLimiters(); // Reset state to ensure fresh count
        // Trigger 5 failures
        for (let i = 0; i < 5; i++) {
            await request(app).post("/auth").send({}).expect(400);
        }
        // The 6th should be 429
        await request(app).post("/auth").send({}).expect(429);
    });
});
