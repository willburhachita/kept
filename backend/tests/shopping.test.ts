/**
 * Policy-aware product search: the budget becomes the search filters, and offers are
 * paid to an allowlisted PayPal email when one matches the retailer.
 */
import { officeSuppliesMandate, type MandatePolicy } from "@kept/core";
import { describe, expect, it } from "vitest";
import { payeeFor, searchFiltersFor } from "../convex/shopping";

const policy: MandatePolicy = { ...officeSuppliesMandate, version: 1, allowedMerchants: ["@supplies.example.com", "orders@coffee.example.com"], perPurchaseMaxCents: 5000 };

describe("searchFiltersFor", () => {
  it("caps the price at the per-purchase limit", () => {
    expect(searchFiltersFor(policy, 20_000).price?.max_price).toBe(50);
  });
  it("caps the price at what's left when that is lower", () => {
    expect(searchFiltersFor(policy, 1_250).price?.max_price).toBe(12.5);
  });
  it("searches only allowlisted retailers", () => {
    expect(searchFiltersFor(policy, 20_000).website_ids).toEqual(["supplies.example.com", "coffee.example.com"]);
  });
  it("searches every retailer when any merchant is allowed", () => {
    expect(searchFiltersFor({ ...policy, allowedMerchants: [] }, 20_000).website_ids).toBeUndefined();
  });
});

describe("payeeFor", () => {
  it("pays the allowlisted PayPal email on the retailer's domain", () => {
    expect(payeeFor(policy, "coffee.example.com")).toBe("orders@coffee.example.com");
  });
  it("falls back to the retailer's stand-in address, ignoring www", () => {
    expect(payeeFor(policy, "www.supplies.example.com")).toBe("paypal@supplies.example.com");
  });
});
