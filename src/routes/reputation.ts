import { Router, Request, Response } from "express";
import { getReputationApiResponse } from "../modules/reputation/reputation.service";
import { enqueueReputationCalculation } from "../jobs/calculate-reputation.job";

const router = Router();

router.get("/users/:id/reputation", async (req: Request, res: Response) => {
  const { id } = req.params;
  const response = getReputationApiResponse(id);

  if (!response) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(response);
});
