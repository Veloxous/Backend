import { 
  TransactionBuilder, 
  Account, 
  xdr, 
  Operation, 
  Asset,
  Networks
} from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

export class SorobanTransactionService {
  private readonly sorobanContractId: string;
  private readonly networkPassphrase: string;
  private readonly feeBumpSponsorSecret: string | null;

  constructor() {
    this.sorobanContractId = process.env.SWAP_CONTRACT_ID || "";
    this.networkPassphrase = process.env.STELLAR_NETWORK === "mainnet" 
      ? Networks.PUBLIC 
      : Networks.TESTNET;
    this.feeBumpSponsorSecret = process.env.FEE_BUMP_SPONSOR_SECRET || null;
  }

  /**
   * Build XDR for deposit_collateral function call
   */
  async buildDepositCollateralXDR(
    swapId: string,
    amount: number,
    userPublicKey: string,
    sequenceNumber: string
  ): Promise<string> {
    if (!this.sorobanContractId) {
      throw new Error("Swap contract ID not configured");
    }

    // Create account object for the user
    const account = new Account(userPublicKey, sequenceNumber);

    // Create the transaction builder
    const transaction = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    });

    // Prepare the parameters for deposit_collateral
    // Convert swapId to ScVal (string)
    const swapIdScVal = xdr.ScVal.scvString(swapId);
    
    // Convert amount to ScVal (i128)
    const amountScVal = xdr.ScVal.scvI128(
      new xdr.Int128Parts({
        lo: xdr.Uint64.fromString((amount % 1e18).toString()),
        hi: xdr.Int64.fromString(Math.floor(amount / 1e18).toString())
      })
    );

    // Build the Soroban contract invocation
    transaction.addOperation(Operation.invokeHostFunction({
      name: "deposit_collateral",
      args: [swapIdScVal, amountScVal],
      source: userPublicKey,
      contractId: this.sorobanContractId
    }));

    // Set timeout and build the transaction
    const builtTransaction = transaction.setTimeout(300).build();

    // If we're acting as a fee-bump sponsor, wrap the transaction in a fee bump
    if (this.feeBumpSponsorSecret) {
      // In a real implementation, you would sign the fee bump transaction
      // This is a simplified version
      return builtTransaction.toXDR();
    }

    return builtTransaction.toXDR();
  }

  /**
   * Get the current sequence number for a user's account
   */
  async getSequenceNumber(userPublicKey: string): Promise<string> {
    // In a real implementation, you would fetch this from the Stellar RPC
    // For now, we'll return a dummy sequence number - in production this must be fetched from the network
    console.warn("Using mock sequence number - this should be fetched from Stellar RPC in production");
    return "1234567890";
  }
}