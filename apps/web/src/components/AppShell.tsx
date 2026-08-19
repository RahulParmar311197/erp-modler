import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
  activeModule: string;
  onNavigate: (module: string) => void;
};

const navigation = [
  {
    section: "WORKSPACE",
    items: [
      { id: "dashboard", label: "Dashboard" },
    ],
  },
  {
    section: "SALES",
    items: [
      { id: "sales", label: "Sales" },
      { id: "receivables", label: "Accounts Receivable" },
    ],
  },
  {
    section: "PURCHASES",
    items: [
      { id: "purchases", label: "Purchases" },
      { id: "payables", label: "Accounts Payable" },
    ],
  },
  {
    section: "INVENTORY",
    items: [
      { id: "inventory", label: "Inventory" },
    ],
  },
  {
    section: "ACCOUNTING",
    items: [
      { id: "general-ledger", label: "General Ledger" },
      { id: "journal-entries", label: "Journal Entries" },
      { id: "balance-sheet", label: "Balance Sheet" },
      { id: "banking", label: "Banking" },
    ],
  },
  {
    section: "ADMINISTRATION",
    items: [
      { id: "administration", label: "Administration" },
    ],
  },
];

export function AppShell({
  children,
  activeModule,
  onNavigate,
}: AppShellProps) {
  return (
    <div className="erp-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>MODLER</strong>
            <span>ERP SYSTEM</span>
          </div>
        </div>

        <div className="organization">
          <span>ORGANIZATION</span>
          <strong>MODLER India</strong>
          <small>MODLER</small>
        </div>

        <nav className="navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.section}>
              <div className="nav-section">{group.section}</div>

              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${
                    activeModule === item.id ? "active" : ""
                  }`}
                  onClick={() => onNavigate(item.id)}
                >
                  <span className="nav-indicator" />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-dot" />
          <div>
            <strong>API Connected</strong>
            <span>System Administrator</span>
          </div>
        </div>
      </aside>

      <div className="erp-main">
        <header className="erp-header">
          <div>
            <div className="breadcrumb">ERP MODLER / {activeModule}</div>
            <h1>
              {navigation
                .flatMap((group) => group.items)
                .find((item) => item.id === activeModule)?.label ??
                "Dashboard"}
            </h1>
          </div>

          <div className="header-user">
            <div className="avatar">SA</div>
            <div>
              <strong>System Administrator</strong>
              <span>SUPER ADMIN</span>
            </div>
          </div>
        </header>

        <main className="erp-content">{children}</main>
      </div>
    </div>
  );
}
