import express from "express";
import request from "supertest";

// Mock the AWS presigner so no network or credentials are needed. Capture the
// inputs so we can assert expiry and key namespacing.
const mockGetSignedUrl = jest.fn().mockImplementation(async (_client, command) => {
    const key = (command as any).input.Key;
    return `https://test-bucket.s3.us-east-1.amazonaws.com/${key}?X-Amz-Signature=presigned`;
});

jest.mock("@aws-sdk/s3-request-presigner", () => ({
    getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
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

const app = express();
app.use(express.json());
app.use("/uploads", uploadsRouter);

describe("uploads routes — POST /presign", () => {
    beforeEach(() => {
        mockGetSignedUrl.mockClear();
    });

    it("returns 401 without an authenticated user", async () => {
        const res = await request(app)
            .post("/uploads/presign")
            .send({ filename: "cat.jpg", contentType: "image/jpeg" });

        expect(res.status).toBe(401);
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("returns 400 for a non-whitelisted content type", async () => {
        const res = await request(app)
            .post("/uploads/presign")
            .set("x-user-id", "user-1")
            .send({ filename: "malware.exe", contentType: "application/exe" });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain("image/jpeg");
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("returns 400 when filename or contentType are missing", async () => {
        const res = await request(app)
            .post("/uploads/presign")
            .set("x-user-id", "user-1")
            .send({ filename: "cat.jpg" });

        expect(res.status).toBe(400);
    });

    it.each(["image/jpeg", "image/png", "image/webp"])(
        "presigns %s with a 5 minute expiry under the user's namespace",
        async (contentType) => {
            const res = await request(app)
                .post("/uploads/presign")
                .set("x-user-id", "user-1")
                .send({ filename: "photo", contentType, sizeBytes: 1024 });

            expect(res.status).toBe(200);
            expect(res.body.expiresIn).toBe(300);
            // Signed with the exact namespaced key
            const commandInput = mockGetSignedUrl.mock.calls[0][1].input;
            expect(commandInput.Key).toMatch(new RegExp(`^uploads/user-1/[0-9a-f-]{36}\\.${contentType.split("/")[1].replace("jpeg", "jpg")}$`));
            expect(commandInput.ContentType).toBe(contentType);
            // Client gets both URLs
            expect(res.body.uploadUrl).toContain("uploads/user-1/");
            expect(res.body.cdnUrl).toContain(`uploads/user-1/`);
        }
    );

    it("returns 413 when the declared size exceeds 10MB", async () => {
        const res = await request(app)
            .post("/uploads/presign")
            .set("x-user-id", "user-1")
            .send({
                filename: "huge.png",
                contentType: "image/png",
                sizeBytes: 10 * 1024 * 1024 + 1,
            });

        expect(res.status).toBe(413);
        expect(res.body.error).toBe("Payload Too Large");
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("accepts a file exactly at the 10MB limit", async () => {
        const res = await request(app)
            .post("/uploads/presign")
            .set("x-user-id", "user-1")
            .send({
                filename: "exact.png",
                contentType: "image/png",
                sizeBytes: 10 * 1024 * 1024,
            });

        expect(res.status).toBe(200);
    });
});

describe("S3Service.validateImageOwnership", () => {
    const service = new S3Service({} as any);

    it("accepts a URL inside the user's own namespace", () => {
        expect(
            service.validateImageOwnership(
                "user-1",
                "https://cdn.example.com/uploads/user-1/550e8400-e29b-41d4-a716-446655440000.jpg"
            )
        ).toBe(true);
    });

    it("rejects a URL in another user's namespace", () => {
        expect(
            service.validateImageOwnership(
                "user-1",
                "https://cdn.example.com/uploads/user-2/550e8400-e29b-41d4-a716-446655440000.jpg"
            )
        ).toBe(false);
    });

    it("rejects path traversal out of the namespace", () => {
        expect(
            service.validateImageOwnership(
                "user-1",
                "https://cdn.example.com/uploads/user-1/..%2f..%2fsecret.jpg"
            )
        ).toBe(false);
    });

    it("rejects malformed URLs", () => {
        expect(service.validateImageOwnership("user-1", "not a url")).toBe(false);
    });

    it("rejects bare paths that only look similar", () => {
        expect(
            service.validateImageOwnership(
                "user-1",
                "https://cdn.example.com/uploads/user-10/file.jpg" // prefix overlap, not ownership
            )
        ).toBe(false);
    });
});
