export interface Transaction {
  id: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  currency: string;
  completedAt: Date;
  category: "buy" | "sell" | "swap" | "repair";
}

export interface Dispute {
  id: string;
  reporterId: string;
  respondentId: string;
  resolvedAt: Date;
  winnerId: string | null;
  loserId: string | null;
}
