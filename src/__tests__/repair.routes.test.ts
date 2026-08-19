import express from "express";
import request from "supertest";

const mockRepairRequests = new Map<string, any>();
const mockMilestones = new Map<string, any[]>();

const mockQuery = jest.fn().mockImplementation(async (query: string, params: any[]) => {
  if (query.includes("INSERT INTO repair_requests")) {
    const repair = {
      id: "test-repair-id",
      user_id: params[0],
      technician_id: params[1],
      device_type: params[2],
      description: params[3],
      status: "pending",
      total_quote: null,
      escrow_funded: false,
      escrow_transaction_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockRepairRequests.set(repair.id, repair);
    return { rowCount: 1, rows: [repair] };
  }

  if (query.includes("SELECT * FROM repair_requests WHERE id = $1 AND technician_id = $2 AND status = 'pending'")) {
    const repair = mockRepairRequests.get(params[0]);
    if (repair && repair.technician_id === params[1] && repair.status === "pending") {
      return { rowCount: 1, rows: [repair] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("SELECT * FROM repair_requests WHERE id = $1 AND user_id = $2 AND status = 'in_progress'")) {
    const repair = mockRepairRequests.get(params[0]);
    if (repair && repair.user_id === params[1] && repair.status === "in_progress") {
      return { rowCount: 1, rows: [repair] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("SELECT * FROM repair_requests WHERE id = $1 AND user_id = $2 AND status = 'quoted'")) {
    const repair = mockRepairRequests.get(params[0]);
    if (repair && repair.user_id === params[1] && repair.status === "quoted") {
      return { rowCount: 1, rows: [repair] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("SELECT * FROM repair_requests WHERE id = $1")) {
    const repair = mockRepairRequests.get(params[0]);
    if (repair) {
      return { rowCount: 1, rows: [repair] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("UPDATE repair_requests") && query.includes("status = 'quoted'")) {
    const repair = mockRepairRequests.get(params[1]);
    if (repair) {
      repair.status = "quoted";
      repair.total_quote = params[0];
      return { rowCount: 1, rows: [repair] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("UPDATE repair_requests") && query.includes("status = 'accepted'")) {
    const repair = mockRepairRequests.get(params[1]);
    if (repair) {
      repair.status = "accepted";
      repair.escrow_funded = true;
      repair.escrow_transaction_id = params[0];
      return { rowCount: 1, rows: [repair] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("INSERT INTO repair_milestones")) {
    const milestone = {
      id: `milestone-${params[1]}`,
      repair_id: params[0],
      milestone_number: params[1],
      title: params[2],
      description: params[3],
      amount: params[4],
      status: "pending",
      completed_at: null,
      approved_at: null,
      paid_at: null,
    };
    const existing = mockMilestones.get(params[0]) || [];
    existing.push(milestone);
    mockMilestones.set(params[0], existing);
    return { rowCount: 1, rows: [milestone] };
  }

  if (query.includes("SELECT * FROM repair_milestones WHERE repair_id = $1 ORDER BY milestone_number")) {
    const milestones = mockMilestones.get(params[0]) || [];
    return { rowCount: milestones.length, rows: milestones };
  }

  if (query.includes("DELETE FROM repair_milestones WHERE repair_id = $1")) {
    mockMilestones.delete(params[0]);
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("SELECT status FROM repair_milestones WHERE repair_id = $1 AND milestone_number = $2")) {
    const milestones = mockMilestones.get(params[0]) || [];
    const milestone = milestones.find((m: any) => m.milestone_number === params[1]);
    if (milestone) {
      return { rowCount: 1, rows: [{ status: milestone.status }] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("SELECT * FROM repair_milestones WHERE repair_id = $1 AND milestone_number = $2 AND status = 'pending'")) {
    const milestones = mockMilestones.get(params[0]) || [];
    const milestone = milestones.find((m: any) => m.milestone_number === params[1] && m.status === "pending");
    if (milestone) {
      return { rowCount: 1, rows: [milestone] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("SELECT * FROM repair_milestones WHERE repair_id = $1 AND milestone_number = $2 AND status = 'completed'")) {
    const milestones = mockMilestones.get(params[0]) || [];
    const milestone = milestones.find((m: any) => m.milestone_number === params[1] && m.status === "completed");
    if (milestone) {
      return { rowCount: 1, rows: [milestone] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("UPDATE repair_milestones SET status = 'completed'")) {
    const milestones = mockMilestones.get(params[0]) || [];
    const milestone = milestones.find((m: any) => m.milestone_number === params[1]);
    if (milestone) {
      milestone.status = "completed";
      milestone.completed_at = new Date();
      return { rowCount: 1, rows: [milestone] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("UPDATE repair_milestones SET status = 'approved'")) {
    const milestones = mockMilestones.get(params[0]) || [];
    const milestone = milestones.find((m: any) => m.milestone_number === params[1]);
    if (milestone) {
      milestone.status = "approved";
      milestone.approved_at = new Date();
      return { rowCount: 1, rows: [milestone] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("UPDATE repair_requests SET status = 'in_progress'")) {
    const repair = mockRepairRequests.get(params[0]);
    if (repair && repair.status === "accepted") {
      repair.status = "in_progress";
      return { rowCount: 1, rows: [repair] };
    }
    return { rowCount: 0, rows: [] };
  }

  if (query.includes("UPDATE repair_requests SET status = 'completed'")) {
    const repair = mockRepairRequests.get(params[0]);
    if (repair) {
      repair.status = "completed";
      return { rowCount: 1, rows: [repair] };
    }
    return { rowCount: 0, rows: [] };
  }

  return { rowCount: 0, rows: [] };
});

jest.mock("../db/db", () => ({
  pool: {
    query: mockQuery,
  },
  withTransaction: jest.fn().mockImplementation(async (callback: any) => {
    const mockClient = {
      query: mockQuery,
    };
    return callback(mockClient);
  }),
}));

import repairRouter from "../routes/repair.routes";

const app = express();
app.use(express.json());
app.use("/repair", repairRouter);

describe("Repair Routes", () => {
  beforeEach(() => {
    mockRepairRequests.clear();
    mockMilestones.clear();
  });

  describe("POST /repair/request", () => {
    it("should create a repair request", async () => {
      const response = await request(app)
        .post("/repair/request")
        .set("x-user-id", "user-123")
        .send({
          technician_id: "tech-456",
          device_type: "iphone-14",
          description: "Screen cracked",
        })
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.user_id).toBe("user-123");
      expect(response.body.technician_id).toBe("tech-456");
      expect(response.body.status).toBe("pending");
    });

    it("should return 401 without user ID", async () => {
      await request(app)
        .post("/repair/request")
        .send({
          technician_id: "tech-456",
          device_type: "iphone-14",
          description: "Screen cracked",
        })
        .expect(401);
    });

    it("should return 400 with missing fields", async () => {
      await request(app)
        .post("/repair/request")
        .set("x-user-id", "user-123")
        .send({
          technician_id: "tech-456",
        })
        .expect(400);
    });
  });

  describe("POST /repair/:id/quote", () => {
    it("should submit a quote with milestones", async () => {
      mockRepairRequests.set("repair-1", {
        id: "repair-1",
        user_id: "user-123",
        technician_id: "tech-456",
        status: "pending",
      });

      const response = await request(app)
        .post("/repair/repair-1/quote")
        .set("x-user-id", "tech-456")
        .send({
          total_quote: 200,
          milestones: [
            { title: "Diagnosis", amount: 50 },
            { title: "Repair", amount: 150 },
          ],
        })
        .expect(200);

      expect(response.body.repair.status).toBe("quoted");
      expect(response.body.milestones).toHaveLength(2);
    });

    it("should return 400 when milestone amounts don't sum to total", async () => {
      mockRepairRequests.set("repair-1", {
        id: "repair-1",
        user_id: "user-123",
        technician_id: "tech-456",
        status: "pending",
      });

      await request(app)
        .post("/repair/repair-1/quote")
        .set("x-user-id", "tech-456")
        .send({
          total_quote: 200,
          milestones: [
            { title: "Diagnosis", amount: 50 },
          ],
        })
        .expect(400);
    });
  });

  describe("PATCH /repair/:id/accept-quote", () => {
    it("should accept quote and fund escrow", async () => {
      mockRepairRequests.set("repair-1", {
        id: "repair-1",
        user_id: "user-123",
        technician_id: "tech-456",
        status: "quoted",
      });

      const response = await request(app)
        .patch("/repair/repair-1/accept-quote")
        .set("x-user-id", "user-123")
        .send({
          escrow_transaction_id: "tx-abc-123",
        })
        .expect(200);

      expect(response.body.status).toBe("accepted");
      expect(response.body.escrow_funded).toBe(true);
    });

    it("should return 401 without user ID", async () => {
      await request(app)
        .patch("/repair/repair-1/accept-quote")
        .send({
          escrow_transaction_id: "tx-abc-123",
        })
        .expect(401);
    });
  });

  describe("GET /repair/:id", () => {
    it("should return repair with milestones for involved user", async () => {
      mockRepairRequests.set("repair-1", {
        id: "repair-1",
        user_id: "user-123",
        technician_id: "tech-456",
        status: "pending",
      });

      const response = await request(app)
        .get("/repair/repair-1")
        .set("x-user-id", "user-123")
        .expect(200);

      expect(response.body.id).toBe("repair-1");
      expect(response.body).toHaveProperty("milestones");
    });

    it("should return 403 for non-involved user", async () => {
      mockRepairRequests.set("repair-1", {
        id: "repair-1",
        user_id: "user-123",
        technician_id: "tech-456",
        status: "pending",
      });

      await request(app)
        .get("/repair/repair-1")
        .set("x-user-id", "user-999")
        .expect(403);
    });
  });
});
