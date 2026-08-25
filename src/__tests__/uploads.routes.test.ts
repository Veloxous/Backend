import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret";
process.env.CDN_BASE_URL = "";

// Mock the presigned POST creator so no network or credentials are needed.
const mockCreatePresignedPost = jest.fn().mockResolvedValue({
    url: "https://test-bucket.s3.amazonaws.com",
    fields: {
        key: "uploads/user-1/abc.jpg",
        Policy: "policy",
        "X-Amz-Signature": "sig",
    },
});

jest.mock("@aws-sdk/s3-presigned-post", () => ({
    createPresignedPost: (...args: any[]) => mockCreatePresignedPost(...args),
}));

jest.mock("@aws-sdk/client-s3", () => {
    class PutObjectCommand {
        input: any;
        constructor(input: any) {
            this.input = input;
        }
    }
    return { S3Client: jest.fn(() => ({})), PutObjectCommand };
});

import uploadsRouter from "../routes/uploads.routes";
import { S3Service } from "../services/uploads/s3.service";

function authHeaderFor(userId: string): string {
    const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET!, { expiresIn: "1h" });
    return `Bearer ${token}`;
}

const app = express();
app.use(express.json());
app.use("/uploads", uploadsRouter);

describe("uploads routes — POST /presign", () => {
    beforeEach(() => {
        mockCreatePresignedPost.mockClear();
    });

    it("returns 401 without a valid bearer token", async () => {
        const res = await request(app)
            .post("/uploads/presign")
            .set("x-user-id", "user-1") // header alone must NOT authenticate
            .send({ filename: "cat.jpg", contentType: "image/jpeg" });

        expect(res.status).toBe(401);
        expect(mockCreatePresignedPost).not.toHaveBeenCalled();
    });

    it("returns 401 for a tampered token even with a spoofed x-user-id", async () => {
        const res = await request(app)
            .post("/uploads/presign")
            .set("Authorization", "Bearer not.a.real.token")
            .set("x-user-id", "user-1")
            .send({ filename: "cat.jpg", contentType: "image/jpeg" });

        expect(res.status).toBe(401);
    });

    it("returns 400 for a non-whitelisted content type", async () => {
        const res = await request(app)
            .post("/uploads/presign")
            .set("Authorization", authHeaderFor("user-1"))
            .send({ filename: "malware.exe", contentType: "application/exe" });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain("image/jpeg");
        expect(mockCreatePresignedPost).not.toHaveBeenCalled();
    });

    it("returns 400 when filename or contentType are missing", async () => {
        const res = await request(app)
            .post("/uploads/presign")
            .set("Authorization", authHeaderFor("user-1"))
            .send({ filename: "cat.jpg" });

        expect(res.status).toBe(400);
    });

    it.each(["image/jpeg", "image/png", "image/webp"])(
        "presigns %s under the authenticated user's namespace",
        async (contentType) => {
            const res = await request(app)
                .post("/uploads/presign")
                .set("Authorization", authHeaderFor("user-1"))
                .send({ filename: "photo", contentType, sizeBytes: 1024 });

            expect(res.status).toBe(200);
            expect(res.body.expiresIn).toBe(300);

            // Signed with the exact namespaced key and content type
            const [, config] = mockCreatePresignedPost.mock.calls[0];
            expect(config.Key).toMatch(
                new RegExp(`^uploads/user-1/[0-9a-f-]{36}\\.${contentType.split("/")[1].replace("jpeg", "jpg")}$`)
            );

            // The policy enforces the content type AND the 10MB cap server-side
            const conditions = config.Conditions as any[];
            expect(conditions).toContainEqual({ "Content-Type": contentType });
            expect(conditions).toContainEqual(["content-length-range", 1, 10 * 1024 * 1024]);

            // Client gets both the upload target and the CDN URL
            expect(res.body.upload.key).toContain("uploads/user-1/");
            expect(res.body.cdnUrl).toContain(`uploads/user-1/`);
        }
    );

    it("returns 413 when the declared size exceeds 10MB", async () => {
        const res = await request(app)
            .post("/uploads/presign")
            .set("Authorization", authHeaderFor("user-1"))
            .send({
                filename: "huge.png",
                contentType: "image/png",
                sizeBytes: 10 * 1024 * 1024 + 1,
            });

        expect(res.status).toBe(413);
        expect(res.body.error).toBe("Payload Too Large");
        expect(mockCreatePresignedPost).not.toHaveBeenCalled();
    });
});

describe("S3Service.validateImageOwnership", () => {
    function serviceWith(cdn?: string): S3Service {
        const svc = new S3Service({} as any);
        (svc as any).cdnBaseUrl = cdn ?? "";
        (svc as any).bucket = "veloxous-uploads";
        (svc as any).region = "us-east-1";
        return svc;
    }

    it("accepts a URL inside the user's own namespace on a trusted origin", () => {
        expect(
            serviceWith().validateImageOwnership(
                "user-1",
                "https://veloxous-uploads.s3.us-east-1.amazonaws.com/uploads/user-1/550e8400-e29b-41d4-a716-446655440000.jpg"
            )
        ).toBe(true);
    });

    it("accepts CDN-hosted URLs when a CDN base is configured", () => {
        const svc = serviceWith("https://img.veloxous.io");
        expect(
            svc.validateImageOwnership(
                "user-1",
                "https://img.veloxous.io/uploads/user-1/photo.jpg"
            )
        ).toBe(true);
    });

    it("rejects URLs hosted anywhere other than our storage", () => {
        expect(
            serviceWith().validateImageOwnership(
                "user-1",
                "https://evil.example.com/uploads/user-1/photo.jpg"
            )
        ).toBe(false);
    });

    it("rejects a URL in another user's namespace", () => {
        expect(
            serviceWith().validateImageOwnership(
                "user-1",
                "https://veloxous-uploads.s3.us-east-1.amazonaws.com/uploads/user-2/photo.jpg"
            )
        ).toBe(false);
    });

    it("rejects path traversal out of the namespace", () => {
        expect(
            serviceWith().validateImageOwnership(
                "user-1",
                "https://veloxous-uploads.s3.us-east-1.amazonaws.com/uploads/user-1/..%2f..%2fsecret.jpg"
            )
        ).toBe(false);
    });

    it("rejects malformed URLs", () => {
        expect(serviceWith().validateImageOwnership("user-1", "not a url")).toBe(false);
    });

    it("rejects prefix-overlap look-alikes (user-10 vs user-1)", () => {
        expect(
            serviceWith().validateImageOwnership(
                "user-1",
                "https://veloxous-uploads.s3.us-east-1.amazonaws.com/uploads/user-10/file.jpg"
            )
        ).toBe(false);
    });
});
