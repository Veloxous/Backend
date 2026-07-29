import * as StellarSdk from "@stellar/stellar-sdk";

console.log("StellarSdk exports WebAuth:", !!StellarSdk.WebAuth);
if (StellarSdk.WebAuth) {
    console.log("WebAuth keys:", Object.keys(StellarSdk.WebAuth));
}
console.log("StellarSdk exports Utils:", !!StellarSdk.Utils);
if (StellarSdk.Utils) {
    console.log("Utils keys:", Object.keys(StellarSdk.Utils));
}
