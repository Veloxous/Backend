export interface Transaction {
  id: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  currency: string;
  completedAt: Date;
  category: "buy" | "sell" | "swap" | "repair";
}
