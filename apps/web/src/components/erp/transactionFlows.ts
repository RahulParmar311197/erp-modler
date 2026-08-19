export const SALES_FLOW = [
  "Sales Order",
  "Delivery",
  "Sales Invoice",
  "Receipt",
] as const;

export const PURCHASE_FLOW = [
  "Purchase Order",
  "Goods Receipt",
  "Purchase Bill",
  "Payment",
] as const;

export const INVENTORY_FLOW = [
  "Stock Receipt",
  "Stock Transfer",
  "Stock Issue",
  "Adjustment",
] as const;

export const ACCOUNTING_FLOW = [
  "Voucher",
  "Journal",
  "Ledger",
  "Trial Balance",
] as const;

export const BANKING_FLOW = [
  "Receipt",
  "Deposit",
  "Bank Reconciliation",
] as const;
