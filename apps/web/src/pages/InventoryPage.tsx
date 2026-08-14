import { useMemo, useState } from "react";

type Item = {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  itemType?: string;
  trackInventory?: boolean;
  active?: boolean;
  itemGroup?: {
    id?: string;
    code?: string;
    name?: string;
  } | null;
  baseUom?: {
    id?: string;
    code?: string;
    name?: string;
  } | null;
};

type Warehouse = {
  id: string;
  code: string;
  name: string;
};

type StockBalance = {
  id: string;
  itemId: string;
  warehouseId: string;
  binId?: string | null;
  quantity: number | string;
};

type StockMovement = {
  id: string;
  movementType?: string;
  quantity: number | string;
  createdAt: string;
  item?: Item | null;
  warehouse?: Warehouse | null;
};

type ItemGroup = {
  id: string;
  code: string;
  name: string;
};

type UnitOfMeasure = {
  id: string;
  code: string;
  name: string;
  symbol?: string | null;
};

type InventoryPageProps = {
  token: string;
  items: Item[];
  warehouses: Warehouse[];
  stockBalances: StockBalance[];
  stockMovements: StockMovement[];
  onRefresh: () => Promise<void>;
};

const API = "";

function apiError(result: any, fallback: string) {
  return result?.errors?.[0]?.message ?? fallback;
}

export function InventoryPage({
  token,
  items,
  warehouses,
  stockBalances,
  stockMovements,
  onRefresh,
}: InventoryPageProps) {
  const [activeTab, setActiveTab] = useState<"items" | "stock">("items");
  const [showItemForm, setShowItemForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingMasters, setLoadingMasters] = useState(false);
  const [error, setError] = useState("");

  const [itemGroups, setItemGroups] = useState<ItemGroup[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [itemGroupId, setItemGroupId] = useState("");
  const [baseUomId, setBaseUomId] = useState("");
  const [itemType, setItemType] = useState("STOCK");
  const [trackInventory, setTrackInventory] = useState(true);
  const [search, setSearch] = useState("");

  const totalQuantity = stockBalances.reduce(
    (sum, balance) => sum + Number(balance.quantity),
    0,
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return items;

    return items.filter((item) =>
      [
        item.sku,
        item.name,
        item.itemGroup?.code,
        item.itemGroup?.name,
        item.baseUom?.code,
        item.baseUom?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [items, search]);

  async function loadItemMasters() {
    if (!token) return;

    setLoadingMasters(true);
    setError("");

    try {
      const headers = {
        Authorization: `Bearer ${token}`,
      };

      const [groupsResponse, unitsResponse] = await Promise.all([
        fetch(`${API}/api/item-groups`, { headers }),
        fetch(`${API}/api/units-of-measure`, { headers }),
      ]);

      const [groupsResult, unitsResult] = await Promise.all([
        groupsResponse.json(),
        unitsResponse.json(),
      ]);

      if (!groupsResponse.ok) {
        throw new Error(
          apiError(groupsResult, "Unable to load item groups"),
        );
      }

      if (!unitsResponse.ok) {
        throw new Error(
          apiError(unitsResult, "Unable to load units of measure"),
        );
      }

      setItemGroups(groupsResult.data ?? []);
      setUnits(unitsResult.data ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load item masters",
      );
    } finally {
      setLoadingMasters(false);
    }
  }

  function openItemForm() {
    setError("");
    setShowItemForm(true);

    if (itemGroups.length === 0 || units.length === 0) {
      void loadItemMasters();
    }
  }

  function resetItemForm() {
    setSku("");
    setName("");
    setDescription("");
    setItemGroupId("");
    setBaseUomId("");
    setItemType("STOCK");
    setTrackInventory(true);
    setShowItemForm(false);
  }

  async function createItem(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (!sku.trim() || !name.trim() || !baseUomId) {
      setError("SKU, name and base unit of measure are required.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API}/api/items`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sku: sku.trim(),
          name: name.trim(),
          description: description.trim() || undefined,
          itemGroupId: itemGroupId || undefined,
          baseUomId,
          itemType,
          trackInventory,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to create item"),
        );
      }

      resetItemForm();
      await onRefresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create item",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">INVENTORY</div>
            <h2>Items & Inventory</h2>
            <p>Manage item master data and monitor inventory.</p>
          </div>

          <div className="button-row">
            {activeTab === "items" && (
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  if (showItemForm) {
                    resetItemForm();
                  } else {
                    openItemForm();
                  }
                }}
              >
                {showItemForm ? "Close" : "+ New Item"}
              </button>
            )}

            <button
              type="button"
              className="secondary-button"
              onClick={() => void onRefresh()}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="cards">
          <div className="card">
            <span>Items</span>
            <strong>{items.length}</strong>
          </div>

          <div className="card">
            <span>Warehouses</span>
            <strong>{warehouses.length}</strong>
          </div>

          <div className="card">
            <span>Stock Records</span>
            <strong>{stockBalances.length}</strong>
          </div>

          <div className="card">
            <span>Total Quantity</span>
            <strong>{totalQuantity.toLocaleString("en-IN")}</strong>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="tabs">
            <button
              type="button"
              className={activeTab === "items" ? "tab active" : "tab"}
              onClick={() => setActiveTab("items")}
            >
              Items
            </button>

            <button
              type="button"
              className={activeTab === "stock" ? "tab active" : "tab"}
              onClick={() => setActiveTab("stock")}
            >
              Stock
            </button>
          </div>
        </div>

        {activeTab === "items" && showItemForm && (
          <form className="form-grid create-form" onSubmit={createItem}>
            <label>
              SKU
              <input
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                placeholder="ITEM-001"
                required
              />
            </label>

            <label>
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Product name"
                required
              />
            </label>

            <label>
              Item Type
              <select
                value={itemType}
                onChange={(event) => setItemType(event.target.value)}
              >
                <option value="STOCK">Stock</option>
                <option value="SERVICE">Service</option>
                <option value="NON_STOCK">Non-stock</option>
              </select>
            </label>

            <label>
              Base UOM
              <select
                value={baseUomId}
                onChange={(event) => setBaseUomId(event.target.value)}
                required
                disabled={loadingMasters}
              >
                <option value="">
                  {loadingMasters ? "Loading..." : "Select UOM"}
                </option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} — {unit.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Item Group
              <select
                value={itemGroupId}
                onChange={(event) => setItemGroupId(event.target.value)}
                disabled={loadingMasters}
              >
                <option value="">No item group</option>
                {itemGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.code} — {group.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Description
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional description"
              />
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={trackInventory}
                onChange={(event) =>
                  setTrackInventory(event.target.checked)
                }
              />
              Track inventory
            </label>

            <div style={{ display: "flex", alignItems: "end" }}>
              <button
                type="submit"
                className="primary-button"
                disabled={saving || loadingMasters}
              >
                {saving ? "Creating..." : "Create Item"}
              </button>
            </div>
          </form>
        )}

        {activeTab === "items" ? (
          <>
            <div className="panel-toolbar">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search SKU, item, group or UOM..."
              />
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Item</th>
                    <th>Group</th>
                    <th>UOM</th>
                    <th>Type</th>
                    <th>Inventory</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.sku}</strong>
                      </td>
                      <td>
                        <strong>{item.name}</strong>
                        {item.description && (
                          <div className="muted">{item.description}</div>
                        )}
                      </td>
                      <td>
                        {item.itemGroup?.name ??
                          item.itemGroup?.code ??
                          "—"}
                      </td>
                      <td>
                        {item.baseUom?.code ??
                          item.baseUom?.name ??
                          "—"}
                      </td>
                      <td>{item.itemType ?? "STOCK"}</td>
                      <td>{item.trackInventory === false ? "No" : "Yes"}</td>
                      <td>
                        <span
                          className={`status ${
                            item.active === false ? "disabled" : "active"
                          }`}
                        >
                          {item.active === false ? "DISABLED" : "ACTIVE"}
                        </span>
                      </td>
                    </tr>
                  ))}

                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty">
                          {items.length === 0
                            ? "No items found."
                            : "No items match your search."}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>SKU</th>
                    <th>Warehouse</th>
                    <th>Quantity</th>
                  </tr>
                </thead>

                <tbody>
                  {stockBalances.map((balance) => {
                    const item = items.find(
                      (row) => row.id === balance.itemId,
                    );

                    const warehouse = warehouses.find(
                      (row) => row.id === balance.warehouseId,
                    );

                    return (
                      <tr key={balance.id}>
                        <td>
                          <strong>{item?.name ?? "—"}</strong>
                        </td>
                        <td>{item?.sku ?? "—"}</td>
                        <td>
                          {warehouse?.name ??
                            warehouse?.code ??
                            "—"}
                        </td>
                        <td>
                          {Number(balance.quantity).toLocaleString("en-IN")}
                        </td>
                      </tr>
                    );
                  })}

                  {stockBalances.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <div className="empty">
                          No stock balances found.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="panel-header" style={{ marginTop: "24px" }}>
              <div>
                <h2>Recent Stock Movements</h2>
                <p>Latest inventory movement activity.</p>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Warehouse</th>
                    <th>Movement</th>
                    <th>Quantity</th>
                    <th>Date</th>
                  </tr>
                </thead>

                <tbody>
                  {stockMovements.slice(0, 10).map((movement) => (
                    <tr key={movement.id}>
                      <td>{movement.item?.name ?? "—"}</td>
                      <td>
                        {movement.warehouse?.name ??
                          movement.warehouse?.code ??
                          "—"}
                      </td>
                      <td>
                        <span
                          className={`status ${
                            movement.movementType ?? "movement"
                          }`}
                        >
                          {(movement.movementType ?? "MOVEMENT").replaceAll(
                            "_",
                            " ",
                          )}
                        </span>
                      </td>
                      <td>
                        {Number(movement.quantity).toLocaleString("en-IN")}
                      </td>
                      <td>
                        {new Date(
                          movement.createdAt,
                        ).toLocaleDateString("en-IN")}
                      </td>
                    </tr>
                  ))}

                  {stockMovements.length === 0 && (
                    <tr>
                      <td colSpan={5}>
                        <div className="empty">
                          No stock movements found.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
