import { Router, Request, Response } from "express";
import { RepairService } from "../services/repair/repair.service";

const router = Router();
const repairService = new RepairService();

interface RepairRequestBody {
  technician_id: string;
  device_type: string;
  description: string;
}

router.post("/request", async (req: Request, res: Response) => {
  try {
    const user_id = req.headers["x-user-id"] as string;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { technician_id, device_type, description } = req.body as RepairRequestBody;

    if (!technician_id || !device_type || !description) {
      return res.status(400).json({ error: "technician_id, device_type, and description are required" });
    }

    const repair = await repairService.createRepairRequest(
      user_id,
      technician_id,
      device_type,
      description
    );

    res.status(201).json(repair);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

interface QuoteRequestBody {
  total_quote: number;
  milestones: {
    title: string;
    description?: string;
    amount: number;
  }[];
}

router.post("/:id/quote", async (req: Request, res: Response) => {
  try {
    const technician_id = req.headers["x-user-id"] as string;
    if (!technician_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const { total_quote, milestones } = req.body as QuoteRequestBody;

    if (!total_quote || !milestones || !Array.isArray(milestones)) {
      return res.status(400).json({ error: "total_quote and milestones array are required" });
    }

    const result = await repairService.submitQuote(id, technician_id, {
      total_quote,
      milestones,
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

interface AcceptQuoteBody {
  escrow_transaction_id: string;
}

router.patch("/:id/accept-quote", async (req: Request, res: Response) => {
  try {
    const user_id = req.headers["x-user-id"] as string;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const { escrow_transaction_id } = req.body as AcceptQuoteBody;

    if (!escrow_transaction_id) {
      return res.status(400).json({ error: "escrow_transaction_id is required" });
    }

    const repair = await repairService.acceptQuote(id, user_id, escrow_transaction_id);
    res.json(repair);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/:id/milestone/:n/complete", async (req: Request, res: Response) => {
  try {
    const technician_id = req.headers["x-user-id"] as string;
    if (!technician_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id, n } = req.params;
    const milestoneNumber = parseInt(n, 10);

    if (isNaN(milestoneNumber) || milestoneNumber < 1) {
      return res.status(400).json({ error: "Invalid milestone number" });
    }

    const milestone = await repairService.completeMilestone(id, milestoneNumber, technician_id);
    res.json(milestone);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/:id/milestone/:n/approve", async (req: Request, res: Response) => {
  try {
    const user_id = req.headers["x-user-id"] as string;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id, n } = req.params;
    const milestoneNumber = parseInt(n, 10);

    if (isNaN(milestoneNumber) || milestoneNumber < 1) {
      return res.status(400).json({ error: "Invalid milestone number" });
    }

    const milestone = await repairService.approveMilestone(id, milestoneNumber, user_id);
    res.json(milestone);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const user_id = req.headers["x-user-id"] as string;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const repair = await repairService.getRepairRequest(id);

    if (!repair) {
      return res.status(404).json({ error: "Repair request not found" });
    }

    if (!repairService.isInvolved(repair, user_id)) {
      return res.status(403).json({ error: "Not authorized to view this repair" });
    }

    const milestones = await repairService.getMilestones(id);
    res.json({ ...repair, milestones });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
