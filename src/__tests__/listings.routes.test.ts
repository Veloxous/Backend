import express from "express";
import request from "supertest";
import listingsRouter from "../routes/listings.routes";
import { pool } from "../db/db";

jest.mock("../db/db", () => ({
  pool: {
    query: jest.fn(),
  },
}));

describe("Listings Routes - POST /listings", () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/listings", listingsRouter);
  });

  const validPayload = {
    title: "iPhone 14 Pro Max",
    description: "Space Black, 256GB in pristine condition.",
    category: "smartphone",
    condition: "excellent",
    price: 850.5,
    image_urls: [
      "https://example.com/images/iphone14-front.jpg",
      "https://example.com/images/iphone14-back.jpg",
    ],
    device_type: "iphone-14-pro",
  };

  it("should successfully create a new device listing with valid inputs", async () => {
    const mockCreatedListing = {
      id: "test-listing-uuid",
      owner_id: "user-123",
      title: validPayload.title,
      description: validPayload.description,
      category: "smartphone",
      condition: "excellent",
      price: 850.5,
      image_urls: validPayload.image_urls,
      device_type: "iphone-14-pro",
      estimated_value: 850.5,
      is_locked: false,
      current_swap_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };

    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [mockCreatedListing],
    });

    const response = await request(app)
      .post("/listings")
      .set("x-user-id", "user-123")
      .send(validPayload);

    expect(response.status).toBe(201);
    expect(response.body).toEqual(mockCreatedListing);
    expect(pool.query).toHaveBeenCalledTimes(1);

    const [query, params] = (pool.query as jest.Mock).mock.calls[0];
    expect(query).toContain("INSERT INTO listings");
    expect(params[0]).toBe("user-123");
    expect(params[3]).toBe("smartphone");
    expect(params[4]).toBe("excellent");
    expect(params[5]).toBe(850.5);
    expect(params[6]).toEqual(validPayload.image_urls);
  });

  it("should return 401 Unauthorized if user authentication is missing", async () => {
    const response = await request(app)
      .post("/listings")
      .send(validPayload);

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("error", "Unauthorized");
    expect(pool.query).not.toHaveBeenCalled();
  });

  describe("Category validation", () => {
    it("should return 422 with field-level details if category is missing", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({ ...validPayload, category: undefined });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("Category is required");
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "category",
            message: "Category is required",
          }),
        ])
      );
    });

    it("should return 422 with field-level details if category is invalid", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({ ...validPayload, category: "invalid_category_xyz" });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("Invalid category");
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "category",
            message: expect.stringContaining("Invalid category"),
          }),
        ])
      );
    });
  });

  describe("Condition validation", () => {
    it("should return 422 with field-level details if condition is missing", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({ ...validPayload, condition: undefined });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("Condition is required");
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "condition",
            message: "Condition is required",
          }),
        ])
      );
    });

    it("should return 422 with field-level details if condition is invalid", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({ ...validPayload, condition: "broken_beyond_repair" });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("Invalid condition");
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "condition",
            message: expect.stringContaining("Invalid condition"),
          }),
        ])
      );
    });
  });

  describe("Price (USDC) validation", () => {
    it("should return 422 if price is missing", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({ ...validPayload, price: undefined });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("Price must be a positive number in USDC");
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "price",
            message: "Price must be a positive number in USDC",
          }),
        ])
      );
    });

    it("should return 422 if price is zero", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({ ...validPayload, price: 0 });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("Price must be a positive number in USDC");
    });

    it("should return 422 if price is negative", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({ ...validPayload, price: -50 });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("Price must be a positive number in USDC");
    });

    it("should return 422 if price is non-numeric string", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({ ...validPayload, price: "not_a_number" });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("Price must be a positive number in USDC");
    });
  });

  describe("Image URLs validation", () => {
    it("should return 422 if image_urls is missing", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({ ...validPayload, image_urls: undefined });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("At least one image URL is required");
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "image_urls",
            message: "At least one image URL is required in image_urls",
          }),
        ])
      );
    });

    it("should return 422 if image_urls is an empty array", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({ ...validPayload, image_urls: [] });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("At least one image URL is required");
    });

    it("should return 422 if an image URL is invalid", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({
          ...validPayload,
          image_urls: ["https://valid.com/image.png", "not-a-valid-url"],
        });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("Invalid image URL");
    });

    it("should return 422 if an image URL does not have http/https protocol", async () => {
      const response = await request(app)
        .post("/listings")
        .set("x-user-id", "user-123")
        .send({
          ...validPayload,
          image_urls: ["ftp://server.com/image.png"],
        });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty("error", "Unprocessable Entity");
      expect(response.body.message).toContain("Invalid image URL");
    });
  });
});

describe("Listings Routes - GET /listings", () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/listings", listingsRouter);
  });

  const mockListings = [
    {
      id: "listing-1",
      owner_id: "user-1",
      title: "iPhone 14 Pro",
      category: "phone",
      condition: "excellent",
      price: 800,
      trust_score: 95,
      image_urls: ["https://example.com/1.jpg"],
      created_at: new Date("2026-08-20T10:00:00Z").toISOString(),
      deleted_at: null,
    },
    {
      id: "listing-2",
      owner_id: "user-2",
      title: "MacBook Pro 14",
      category: "laptop",
      condition: "good",
      price: 1400,
      trust_score: 85,
      image_urls: ["https://example.com/2.jpg"],
      created_at: new Date("2026-08-19T10:00:00Z").toISOString(),
      deleted_at: null,
    },
    {
      id: "listing-3",
      owner_id: "user-3",
      title: "iPad Air",
      category: "tablet",
      condition: "like_new",
      price: 550,
      trust_score: 90,
      image_urls: ["https://example.com/3.jpg"],
      created_at: new Date("2026-08-18T10:00:00Z").toISOString(),
      deleted_at: null,
    },
  ];

  it("should return listings with default pagination when no query params are provided", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: mockListings.slice(0, 2),
    });

    const response = await request(app).get("/listings");

    expect(response.status).toBe(200);
    expect(response.body.listings).toHaveLength(2);
    expect(response.body.has_more).toBe(false);
    expect(response.body.next_cursor).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);

    const [sql] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("WHERE deleted_at IS NULL");
    expect(sql).toContain("ORDER BY created_at DESC, id DESC");
  });

  it("should filter by category", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [mockListings[0]],
    });

    const response = await request(app).get("/listings?category=phone");

    expect(response.status).toBe(200);
    const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("LOWER(category) = $1");
    expect(params[0]).toBe("phone");
  });

  it("should filter by condition", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [mockListings[0]],
    });

    const response = await request(app).get("/listings?condition=excellent");

    expect(response.status).toBe(200);
    const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("LOWER(condition) = $1");
    expect(params[0]).toBe("excellent");
  });

  it("should filter by minPrice and maxPrice", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [mockListings[0]],
    });

    const response = await request(app).get("/listings?minPrice=500&maxPrice=1000");

    expect(response.status).toBe(200);
    const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("price >= $1");
    expect(sql).toContain("price <= $2");
    expect(params[0]).toBe(500);
    expect(params[1]).toBe(1000);
  });

  it("should return 400 if minPrice > maxPrice", async () => {
    const response = await request(app).get("/listings?minPrice=1000&maxPrice=500");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("minPrice cannot be greater than maxPrice");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("should query GET /listings?minTrustScore=75 and return only listings with Trust Score >= 75", async () => {
    const listingsWithScores = [
      {
        id: "listing-high-trust-1",
        owner_id: "seller-1",
        title: "High Trust Seller Listing 1",
        category: "phone",
        condition: "excellent",
        price: 800,
        trust_score: 95.0,
        image_urls: ["https://example.com/1.jpg"],
        created_at: new Date().toISOString(),
        deleted_at: null,
      },
      {
        id: "listing-high-trust-2",
        owner_id: "seller-2",
        title: "High Trust Seller Listing 2",
        category: "laptop",
        condition: "good",
        price: 1200,
        trust_score: 75.0,
        image_urls: ["https://example.com/2.jpg"],
        created_at: new Date().toISOString(),
        deleted_at: null,
      },
    ];

    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: listingsWithScores,
    });

    const response = await request(app).get("/listings?minTrustScore=75");

    expect(response.status).toBe(200);
    expect(response.body.listings).toHaveLength(2);
    response.body.listings.forEach((item: any) => {
      expect(item.trust_score).toBeGreaterThanOrEqual(75);
    });

    const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("COALESCE(trust_score, 100.0) >= $1");
    expect(params[0]).toBe(75);
  });

  it("should return 400 for invalid minTrustScore or price", async () => {
    const res1 = await request(app).get("/listings?minTrustScore=-10");
    expect(res1.status).toBe(400);

    const res2 = await request(app).get("/listings?minPrice=abc");
    expect(res2.status).toBe(400);

    const res3 = await request(app).get("/listings?maxPrice=abc");
    expect(res3.status).toBe(400);

    const res4 = await request(app).get("/listings?minPrice=500abc");
    expect(res4.status).toBe(400);

    const res5 = await request(app).get("/listings?minTrustScore=90xyz");
    expect(res5.status).toBe(400);
  });

  it("should sort by price ascending and descending", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    await request(app).get("/listings?sortBy=price");
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain("ORDER BY price ASC, id ASC");

    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    await request(app).get("/listings?sortBy=price_desc");
    expect((pool.query as jest.Mock).mock.calls[1][0]).toContain("ORDER BY price DESC, id DESC");
  });

  it("should sort by date ascending and descending", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    await request(app).get("/listings?sortBy=date_asc");
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain("ORDER BY created_at ASC, id ASC");

    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    await request(app).get("/listings?sortBy=date");
    expect((pool.query as jest.Mock).mock.calls[1][0]).toContain("ORDER BY created_at DESC, id DESC");
  });

  it("should return 400 for invalid sortBy", async () => {
    const response = await request(app).get("/listings?sortBy=invalid_sort");
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Invalid sortBy parameter");
  });

  it("should handle cursor-based pagination and return next_cursor when more items exist", async () => {
    // If limit is 2, query fetches 3 items. If 3 are returned, has_more = true, returns 2 items and next_cursor
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [mockListings[0], mockListings[1], mockListings[2]],
    });

    const response = await request(app).get("/listings?limit=2");

    expect(response.status).toBe(200);
    expect(response.body.listings).toHaveLength(2);
    expect(response.body.has_more).toBe(true);
    expect(response.body.next_cursor).toBeTruthy();

    const nextCursor = response.body.next_cursor;

    // Next request with cursor
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [mockListings[2]],
    });

    const nextResponse = await request(app).get(`/listings?limit=2&cursor=${nextCursor}`);

    expect(nextResponse.status).toBe(200);
    expect(nextResponse.body.listings).toHaveLength(1);
    expect(nextResponse.body.has_more).toBe(false);
    expect(nextResponse.body.next_cursor).toBeNull();
  });

  it("should return 400 for malformed cursor", async () => {
    const response = await request(app).get("/listings?cursor=not-a-valid-cursor-string");
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Invalid cursor");
  });

  it("should return 400 for a cursor with an invalid sort value", async () => {
    const invalidPriceCursor = Buffer.from(
      JSON.stringify({ val: "not-a-price", id: "listing-1" })
    ).toString("base64url");

    const response = await request(app).get(
      `/listings?sortBy=price&cursor=${invalidPriceCursor}`
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Invalid cursor");
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("Listings Routes - GET /listings/:id", () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/listings", listingsRouter);
  });

  const mockListing = {
    id: "listing-123",
    owner_id: "seller-456",
    title: "iPhone 14 Pro Max",
    description: "Space Black 256GB pristine condition",
    category: "smartphone",
    condition: "excellent",
    price: 850.5,
    image_urls: [
      "https://example.com/front.jpg",
      "https://example.com/back.jpg",
    ],
    device_type: "iphone-14-pro",
    estimated_value: 850.5,
    trust_score: 95.5,
    is_locked: false,
    current_swap_id: null,
    owner_email: "seller@example.com",
    created_at: new Date("2026-08-20T12:00:00Z").toISOString(),
    updated_at: new Date("2026-08-20T12:00:00Z").toISOString(),
    deleted_at: null,
    seller_total_listings: 5,
    seller_active_listings: 4,
    seller_avg_trust_score: 96.2,
    seller_member_since: new Date("2026-01-15T00:00:00Z").toISOString(),
  };

  it("should return a single listing with associated seller profile and trust score", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [mockListing],
    });

    const response = await request(app).get("/listings/listing-123");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe("listing-123");
    expect(response.body.title).toBe("iPhone 14 Pro Max");
    expect(response.body.trust_score).toBe(95.5);
    expect(response.body.trustScore).toBe(95.5);

    // Seller profile assertions
    expect(response.body.seller).toBeDefined();
    expect(response.body.seller.id).toBe("seller-456");
    expect(response.body.seller.owner_id).toBe("seller-456");
    expect(response.body.seller.email).toBe("seller@example.com");
    expect(response.body.seller.trust_score).toBe(95.5);
    expect(response.body.seller.total_listings).toBe(5);
    expect(response.body.seller.active_listings).toBe(4);
    expect(response.body.seller.avg_trust_score).toBe(96.2);
    expect(response.body.seller.member_since).toBe(mockListing.seller_member_since);

    // Also accessible via seller_profile
    expect(response.body.seller_profile).toEqual(response.body.seller);

    const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("FROM listings l");
    expect(sql).toContain("WHERE l.id = $1 AND l.deleted_at IS NULL");
    expect(params[0]).toBe("listing-123");
  });

  it("should handle default fallback values when seller stats are not present", async () => {
    const rawListing = {
      id: "listing-simple",
      owner_id: "seller-789",
      title: "Google Pixel 8",
      category: "phone",
      condition: "good",
      price: 500,
      trust_score: null,
      owner_email: null,
      created_at: new Date("2026-08-21T00:00:00Z").toISOString(),
      deleted_at: null,
    };

    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [rawListing],
    });

    const response = await request(app).get("/listings/listing-simple");

    expect(response.status).toBe(200);
    expect(response.body.trust_score).toBe(100.0);
    expect(response.body.seller.trust_score).toBe(100.0);
    expect(response.body.seller.email).toBeNull();
    expect(response.body.seller.total_listings).toBe(1);
    expect(response.body.seller.active_listings).toBe(1);
  });

  it("should return 404 when listing does not exist", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const response = await request(app).get("/listings/non-existent-id");

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("error", "Listing not found");
  });

  it("should return 404 when database throws UUID syntax error (22P02)", async () => {
    const dbError = new Error("invalid input syntax for type uuid: 'invalid-id'");
    (dbError as any).code = "22P02";

    (pool.query as jest.Mock).mockRejectedValueOnce(dbError);

    const response = await request(app).get("/listings/invalid-id");

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("error", "Listing not found");
  });

  it("should return 500 on unexpected database error", async () => {
    (pool.query as jest.Mock).mockRejectedValueOnce(new Error("Database connection lost"));

    const response = await request(app).get("/listings/listing-123");

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Database connection lost");
  });
});

describe("Listings Routes - PATCH /listings/:id", () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/listings", listingsRouter);
  });

  const existingListing = {
    id: "listing-123",
    owner_id: "user-owner",
    title: "Old Title",
    description: "Old Description",
    category: "smartphone",
    condition: "good",
    price: 500,
    image_urls: ["https://example.com/old.jpg"],
    device_type: "phone",
    estimated_value: 500,
    is_locked: false,
    current_swap_id: null,
    deleted_at: null,
  };

  it("should successfully update listing when authenticated as owner", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [existingListing],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            ...existingListing,
            title: "Updated Title",
            price: 550,
            updated_at: new Date().toISOString(),
          },
        ],
      });

    const response = await request(app)
      .patch("/listings/listing-123")
      .set("x-user-id", "user-owner")
      .send({
        title: "Updated Title",
        price: 550,
      });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe("Updated Title");
    expect(response.body.price).toBe(550);

    expect(pool.query).toHaveBeenCalledTimes(2);
    const [updateSql, updateParams] = (pool.query as jest.Mock).mock.calls[1];
    expect(updateSql).toContain("UPDATE listings");
    expect(updateSql).toContain("title = $1");
    expect(updateSql).toContain("price = $2");
    expect(updateSql).toContain("updated_at = NOW()");
    expect(updateParams).toContain("Updated Title");
    expect(updateParams).toContain(550);
  });

  it("should return 401 when user is not authenticated", async () => {
    const response = await request(app)
      .patch("/listings/listing-123")
      .send({ title: "Updated Title" });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("error", "Unauthorized");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("should return 404 when listing does not exist", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const response = await request(app)
      .patch("/listings/non-existent-id")
      .set("x-user-id", "user-owner")
      .send({ title: "Updated Title" });

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("error", "Listing not found");
  });

  it("should return 403 Forbidden when authenticated user is not the owner (strict ownership check)", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [existingListing],
    });

    const response = await request(app)
      .patch("/listings/listing-123")
      .set("x-user-id", "attacker-user-id")
      .send({ title: "Hacked Title" });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Forbidden");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("should return 409 Conflict when listing is locked in a swap", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...existingListing, is_locked: true, current_swap_id: "swap-1" }],
    });

    const response = await request(app)
      .patch("/listings/listing-123")
      .set("x-user-id", "user-owner")
      .send({ title: "New Title" });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("SWAP_LOCKED");
  });

  it("should return 409 Conflict when listing is in ACTIVE_ESCROW state", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...existingListing, status: "ACTIVE_ESCROW" }],
    });

    const response = await request(app)
      .patch("/listings/listing-123")
      .set("x-user-id", "user-owner")
      .send({ title: "New Title" });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("ACTIVE_ESCROW");
  });

  it("should return 409 Conflict when listing is in SWAP_LOCKED state", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...existingListing, status: "SWAP_LOCKED" }],
    });

    const response = await request(app)
      .patch("/listings/listing-123")
      .set("x-user-id", "user-owner")
      .send({ title: "New Title" });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("SWAP_LOCKED");
  });

  it("should return 422 when no fields are provided to update", async () => {
    const response = await request(app)
      .patch("/listings/listing-123")
      .set("x-user-id", "user-owner")
      .send({});

    expect(response.status).toBe(422);
    expect(response.body).toHaveProperty("error", "Unprocessable Entity");
    expect(response.body.message).toContain("No fields provided to update");
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "body",
          message: "No fields provided to update",
        }),
      ])
    );
  });

  it("should return 422 when invalid category or condition is provided", async () => {
    const response = await request(app)
      .patch("/listings/listing-123")
      .set("x-user-id", "user-owner")
      .send({ category: "invalid-category" });

    expect(response.status).toBe(422);
    expect(response.body).toHaveProperty("error", "Unprocessable Entity");
    expect(response.body.message).toContain("Invalid category");
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "category",
          message: expect.stringContaining("Invalid category"),
        }),
      ])
    );
  });

  it("should return 422 when invalid price is provided", async () => {
    const response = await request(app)
      .patch("/listings/listing-123")
      .set("x-user-id", "user-owner")
      .send({ price: -100 });

    expect(response.status).toBe(422);
    expect(response.body).toHaveProperty("error", "Unprocessable Entity");
    expect(response.body.message).toContain("Price must be a positive number in USDC");
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "price",
          message: "Price must be a positive number in USDC",
        }),
      ])
    );
  });
});

describe("Listings Routes - DELETE /listings/:id", () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/listings", listingsRouter);
  });

  const existingListing = {
    id: "listing-123",
    owner_id: "user-owner",
    title: "Device to delete",
    is_locked: false,
    current_swap_id: null,
    deleted_at: null,
  };

  it("should successfully soft-delete listing when authenticated as owner", async () => {
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [existingListing],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...existingListing, deleted_at: new Date().toISOString() }],
      });

    const response = await request(app)
      .delete("/listings/listing-123")
      .set("x-user-id", "user-owner");

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Listing deleted successfully");
    expect(response.body.id).toBe("listing-123");

    expect(pool.query).toHaveBeenCalledTimes(2);
    const [deleteSql, deleteParams] = (pool.query as jest.Mock).mock.calls[1];
    expect(deleteSql).toContain("UPDATE listings");
    expect(deleteSql).toContain("deleted_at = NOW()");
    expect(deleteParams[0]).toBe("listing-123");
  });

  it("should return 401 when user is not authenticated", async () => {
    const response = await request(app).delete("/listings/listing-123");

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("error", "Unauthorized");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("should return 404 when listing does not exist", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 0,
      rows: [],
    });

    const response = await request(app)
      .delete("/listings/non-existent-id")
      .set("x-user-id", "user-owner");

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("error", "Listing not found");
  });

  it("should return 403 Forbidden when authenticated user is not the owner (strict ownership check)", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [existingListing],
    });

    const response = await request(app)
      .delete("/listings/listing-123")
      .set("x-user-id", "non-owner-user");

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("Forbidden");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("should return 409 Conflict when listing is locked in an active swap", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...existingListing, is_locked: true, current_swap_id: "swap-1" }],
    });

    const response = await request(app)
      .delete("/listings/listing-123")
      .set("x-user-id", "user-owner");

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("SWAP_LOCKED");
  });

  it("should return 409 Conflict when listing is in ACTIVE_ESCROW state", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...existingListing, status: "ACTIVE_ESCROW" }],
    });

    const response = await request(app)
      .delete("/listings/listing-123")
      .set("x-user-id", "user-owner");

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("ACTIVE_ESCROW");
  });

  it("should return 409 Conflict when listing is in SWAP_LOCKED state", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...existingListing, status: "SWAP_LOCKED" }],
    });

    const response = await request(app)
      .delete("/listings/listing-123")
      .set("x-user-id", "user-owner");

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("SWAP_LOCKED");
  });

  it("should return 404 when database throws UUID syntax error (22P02)", async () => {
    const dbError = new Error("invalid input syntax for type uuid: 'invalid-id'");
    (dbError as any).code = "22P02";

    (pool.query as jest.Mock).mockRejectedValueOnce(dbError);

    const response = await request(app)
      .delete("/listings/invalid-id")
      .set("x-user-id", "user-owner");

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty("error", "Listing not found");
  });
});



