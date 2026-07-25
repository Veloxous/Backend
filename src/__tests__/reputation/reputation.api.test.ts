import { Router } from "express";
import reputationRouter from "../../routes/reputation";

describe("Reputation API routes", () => {
  it("exports a valid Express router", () => {
    expect(reputationRouter).toBeDefined();
    expect(typeof reputationRouter).toBe("function");
  });

  it("has GET /users/:id/reputation route", () => {
    const routes = (reputationRouter as any).stack;
    const getRoute = routes.find(
      (r: any) => r.route && r.route.path === "/users/:id/reputation"
    );
    expect(getRoute).toBeDefined();
  });

  it("has POST /users/:id/reputation/recalculate route", () => {
    const routes = (reputationRouter as any).stack;
    const postRoute = routes.find(
      (r: any) => r.route && r.route.path === "/users/:id/reputation/recalculate"
    );
    expect(postRoute).toBeDefined();
  });
});
