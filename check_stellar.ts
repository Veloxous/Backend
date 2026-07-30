import * as StellarSdk from "@stellar/stellar-sdk";

const requiredMethods = ["buildChallengeTx", "readChallengeTx", "verifyChallengeTxSigners", "verifyChallengeTxThreshold"];
let missing = false;

console.log("StellarSdk exports WebAuth:", !!StellarSdk.WebAuth);
if (StellarSdk.WebAuth) {
    console.log("WebAuth keys:", Object.keys(StellarSdk.WebAuth));
    for (const method of requiredMethods) {
        const isExported = typeof (StellarSdk.WebAuth as any)[method] === "function";
        console.log(`WebAuth exports ${method}:`, isExported);
        if (!isExported) missing = true;
    }
} else {
    missing = true;
}

console.log("StellarSdk exports Utils:", !!StellarSdk.Utils);
if (StellarSdk.Utils) {
    console.log("Utils keys:", Object.keys(StellarSdk.Utils));
}

if (missing) {
    console.error("Missing required WebAuth methods!");
    process.exit(1);
}
