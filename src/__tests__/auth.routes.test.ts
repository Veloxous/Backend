import express from "express";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import authRouter, { SERVER_KEYPAIR } from "../routes/auth.routes";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());
app.use("/auth", authRouter);

describe("SEP-10 Auth Routes", () => {
    const clientKeypair = StellarSdk.Keypair.random();
    const serverKeypair = SERVER_KEYPAIR;
    const networkPassphrase = StellarSdk.Networks.TESTNET;
    let challengeTransaction: string;

    it("should return a challenge transaction for a valid account", async () => {
        const response = await request(app)
            .get(`/auth?account=${clientKeypair.publicKey()}`)
            .expect(200);

        expect(response.body).toHaveProperty("transaction");
        challengeTransaction = response.body.transaction;
        
        // Verify it's a valid challenge tx
        const tx = StellarSdk.WebAuth.readChallengeTx(
            challengeTransaction,
            serverKeypair.publicKey(),
            networkPassphrase,
            "localhost",
            "localhost"
        );
        expect(tx.clientAccountID).toBe(clientKeypair.publicKey());
    });

    it("should verify a signed challenge and return a JWT", async () => {
        // Sign the challenge with the client keypair
        const tx = new StellarSdk.Transaction(challengeTransaction, networkPassphrase);
        tx.sign(clientKeypair);
        const signedChallenge = tx.toXDR();

        const response = await request(app)
            .post("/auth")
            .send({ transaction: signedChallenge })
            .expect(200);

        expect(response.body).toHaveProperty("token");
        const decoded = jwt.decode(response.body.token) as any;
        expect(decoded.sub).toBe(clientKeypair.publicKey());
    });
});
