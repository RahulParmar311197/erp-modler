import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { AppShell } from "./components/AppShell";
import { SalesPage } from "./pages/SalesPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { InventoryPage } from "./pages/InventoryPage";
import { GeneralLedgerPage } from "./pages/GeneralLedgerPage";
import { JournalEntriesPage } from "./pages/JournalEntriesPage";
import { BalanceSheetPage } from "./pages/BalanceSheetPage";
import { AdministrationPage } from "./pages/AdministrationPage";
import { ReceivablesPage } from "./pages/ReceivablesPage";
import { PayablesPage } from "./pages/PayablesPage";
import { DashboardPage } from "./pages/DashboardPage";

const API = "";

type Customer = {
  id: string;
  code: string;
  name: string;
};

type SalesOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  customer?: Customer | null;
  totalAmount?: number | string;
};

type PurchaseOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  supplier?: Supplier | null;
  totalAmount?: number | string;
};

type Supplier = {
  id: string;
  code: string;
  name: string;
};

type Item = {
  id: string;
  sku: string;
  name: string;
};

type Bill = {
  id: string;
  billNumber: string;
  status: string;
  billDate: string;
  currency: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  supplier: Supplier;
};

type LoginResponse = {
  data: {
    token: string;
  };
};

interface ArInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number | string;
  paidAmount: number | string;
  status: string;
  customer?: {
    id?: string;
    code?: string;
    name: string;
  } | null;
}

interface GlAccount {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface JournalLine {
  id?: string;
  accountId: string;
  debit: number | string;
  credit: number | string;
  description?: string | null;
}

interface JournalEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  status: string;
  lines?: JournalLine[];
}

interface StockBalance {
  id: string;
  itemId: string;
  warehouseId: string;
  binId?: string | null;
  quantity: number | string;
}

function App() {
  const [activeModule, setActiveModule] = useState("dashboard");

  const [token, setToken] = useState("");
  const [bills, setBills] = useState<Bill[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [arInvoices, setArInvoices] = useState<ArInvoice[]>([]);
  const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [stockBalances, setStockBalances] = useState<StockBalance[]>([]);
  const [inventoryWarehouses, setInventoryWarehouses] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const [stockMovements, setStockMovements] = useState<
    {
      id: string;
      movementType?: string;
      quantity: number | string;
      createdAt: string;
      item?: Item | null;
      warehouse?: { id: string; code: string; name: string } | null;
    }[]
  >([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);



  async function login() {
    const response = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantCode: "MODLER",
        email: "admin@modler.local",
        password: "ModlerAdmin@2026!",
      }),
    });

    if (!response.ok) {
      throw new Error("Login failed");
    }

    const result = (await response.json()) as LoginResponse;
    setToken(result.data.token);
    return result.data.token;
  }

  async function loadData(authToken: string) {
    const headers = {
      Authorization: `Bearer ${authToken}`,
    };

    setDashboardLoading(true);

    try {
      const [
        billsResponse,
        suppliersResponse,
        itemsResponse,
        customersResponse,
        salesOrdersResponse,
        purchaseOrdersResponse,
        invoicesResponse,
        accountsResponse,
        journalResponse,
        warehousesResponse,
        stockBalancesResponse,
        stockMovementsResponse,
      ] = await Promise.all([
        fetch(`${API}/api/vendor-bills`, { headers }),
        fetch(`${API}/api/suppliers`, { headers }),
        fetch(`${API}/api/items`, { headers }),
        fetch(`${API}/api/customers`, { headers }),
        fetch(`${API}/api/sales-orders`, { headers }),
        fetch(`${API}/api/purchase-orders`, { headers }),
        fetch(`${API}/api/sales-invoices`, { headers }),
        fetch(`${API}/api/gl/accounts`, { headers }),
        fetch(`${API}/api/gl/journal-entries`, { headers }),
        fetch(`${API}/api/warehouses`, { headers }),
        fetch(`${API}/api/stock-balances`, { headers }),
        fetch(`${API}/api/stock-movements`, { headers }),
      ]);

      const responses = [
        billsResponse,
        suppliersResponse,
        itemsResponse,
        customersResponse,
        salesOrdersResponse,
        purchaseOrdersResponse,
        invoicesResponse,
        accountsResponse,
        journalResponse,
        warehousesResponse,
        stockBalancesResponse,
        stockMovementsResponse,
      ];

      if (responses.some((response) => !response.ok)) {
        const failed = responses.find((response) => !response.ok);
        throw new Error(
          failed
            ? `Unable to load ERP data (${failed.status})`
            : "Unable to load ERP data",
        );
      }

      const [
        billsResult,
        suppliersResult,
        itemsResult,
        customersResult,
        salesOrdersResult,
        purchaseOrdersResult,
        invoicesResult,
        accountsResult,
        journalResult,
        warehousesResult,
        stockBalancesResult,
        stockMovementsResult,
      ] = await Promise.all(responses.map((response) => response.json()));

      setBills(billsResult.data ?? []);
      setSuppliers(suppliersResult.data ?? []);
      setItems(itemsResult.data ?? []);

      setCustomers(customersResult.data ?? []);
      setSalesOrders(salesOrdersResult.data ?? []);
      setPurchaseOrders(purchaseOrdersResult.data ?? []);

      setArInvoices(invoicesResult.data ?? []);

      setGlAccounts(accountsResult.data ?? []);
      setJournalEntries(journalResult.data ?? []);

      setInventoryWarehouses(warehousesResult.data ?? []);
      setStockBalances(stockBalancesResult.data ?? []);
      setStockMovements(stockMovementsResult.data ?? []);
    } finally {
      setDashboardLoading(false);
    }
  }

  async function refresh() {
    if (token) {
      await loadData(token);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const authToken = await login();
        await loadData(authToken);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unexpected error",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
    // Initial application bootstrap intentionally runs once.
    // loadData also reads form-selection state, so including it here
    // would cause the bootstrap request to rerun unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  const dashboardTotals = useMemo(() => {
    const receivables = arInvoices.reduce(
      (sum, invoice) =>
        sum +
        Math.max(
          0,
          Number(invoice.totalAmount) -
            Number(invoice.paidAmount),
        ),
      0,
    );

    const payables = bills.reduce(
      (sum, bill) =>
        sum +
        Math.max(
          0,
          Number(bill.totalAmount) -
            Number(bill.paidAmount),
        ),
      0,
    );

    const stockQuantity = stockBalances.reduce(
      (sum, balance) => sum + Number(balance.quantity),
      0,
    );

    return {
      receivables,
      payables,
      netOutstanding: receivables - payables,
      stockQuantity,
    };
  }, [arInvoices, bills, stockBalances]);

  if (loading) {
    return <main className="app">Loading ERP MODLER...</main>;
  }

  return (
    <AppShell
      activeModule={activeModule}
      onNavigate={setActiveModule}
    >
      <main className="app">
        {error && <div className="error-banner">{error}</div>}

      {activeModule === "dashboard" && (
        <DashboardPage
          loading={dashboardLoading}
          totals={dashboardTotals}
          invoices={arInvoices}
          bills={bills}
          journalEntries={journalEntries}
        />
      )}

      {activeModule === "sales" && (
        <SalesPage
          customers={customers}
          salesOrders={salesOrders}
        />
      )}

      {activeModule === "purchases" && (
        <PurchasesPage
          suppliers={suppliers}
          purchaseOrders={purchaseOrders}
        />
      )}

      {activeModule === "inventory" && (
        <InventoryPage
          token={token}
          items={items}
          warehouses={inventoryWarehouses}
          stockBalances={stockBalances}
          stockMovements={stockMovements}
          onRefresh={refresh}
        />
      )}

      {activeModule === "payables" && (
        <PayablesPage
          token={token}
          bills={bills}
          suppliers={suppliers}
          items={items}
          onRefresh={refresh}
        />
      )}

      {activeModule === "receivables" && (
        <ReceivablesPage
          token={token}
          invoices={arInvoices}
          onRefresh={refresh}
        />
      )}

      {activeModule === "general-ledger" && (
        <GeneralLedgerPage
          token={token}
          glAccounts={glAccounts}
          journalEntries={journalEntries}
        />
      )}

      {activeModule === "journal-entries" && (
        <JournalEntriesPage
          token={token}
          glAccounts={glAccounts}
          journalEntries={journalEntries}
          onRefresh={refresh}
        />
      )}
      {activeModule === "balance-sheet" && (
        <BalanceSheetPage token={token} />
      )}

      {activeModule === "administration" && (
        <AdministrationPage token={token} />
      )}

      {activeModule !== "dashboard" &&
        activeModule !== "sales" &&
        activeModule !== "purchases" &&
        activeModule !== "inventory" &&
        activeModule !== "general-ledger" &&
        activeModule !== "journal-entries" &&
        activeModule !== "balance-sheet" &&
        activeModule !== "administration" &&
        activeModule !== "payables" &&
        activeModule !== "receivables" && (
          <section className="panel module-placeholder">
            <div className="panel-header">
              <div>
                <div className="eyebrow">ERP MODLER</div>
                <h2>{activeModule.replaceAll("-", " ")}</h2>
                <p>
                  This module is ready for the next frontend implementation.
                </p>
              </div>
            </div>

            <div className="empty">
              Existing API workflows remain intact. We will build this
              module next.
            </div>
          </section>
        )}
    </main>
    </AppShell>
  );
}

export default App;
