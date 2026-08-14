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
  const [activeTab, setActiveTab] = useState<"items" | "stock" | "storage" | "operations">("items");
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

  const [locations, setLocations] = useState<any[]>([]);
  const [warehousesMaster, setWarehousesMaster] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [bins, setBins] = useState<any[]>([]);

  const [storageForm, setStorageForm] = useState<
    "location" | "warehouse" | "zone" | "bin" | ""
  >("");

  const [operationForm, setOperationForm] = useState<
    "opening" | "adjustment" | "transfer" | ""
  >("");
  const [operationSaving, setOperationSaving] = useState(false);

  const [operationItemId, setOperationItemId] = useState("");
  const [operationWarehouseId, setOperationWarehouseId] = useState("");
  const [operationBinId, setOperationBinId] = useState("");
  const [operationQuantity, setOperationQuantity] = useState("");
  const [operationNotes, setOperationNotes] = useState("");

  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [sourceBinId, setSourceBinId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [destinationBinId, setDestinationBinId] = useState("");


  const [storageSaving, setStorageSaving] = useState(false);

  const [locationCode, setLocationCode] = useState("");
  const [locationName, setLocationName] = useState("");

  const [warehouseCode, setWarehouseCode] = useState("");
  const [warehouseName, setWarehouseName] = useState("");
  const [warehouseLocationId, setWarehouseLocationId] = useState("");

  const [zoneCode, setZoneCode] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [zoneWarehouseId, setZoneWarehouseId] = useState("");

  const [binCode, setBinCode] = useState("");
  const [binName, setBinName] = useState("");
  const [binZoneId, setBinZoneId] = useState("");

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

  function binsForWarehouse(warehouseId: string) {
    if (!warehouseId) return bins;

    return bins.filter(
      (bin) => bin.zone?.warehouseId === warehouseId,
    );
  }

  function resetOperationForm() {
    setOperationForm("");
    setOperationItemId("");
    setOperationWarehouseId("");
    setOperationBinId("");
    setOperationQuantity("");
    setOperationNotes("");
    setSourceWarehouseId("");
    setSourceBinId("");
    setDestinationWarehouseId("");
    setDestinationBinId("");
  }

  function openOperationForm(
    form: "opening" | "adjustment" | "transfer",
  ) {
    setError("");
    setOperationForm(form);

    if (
      items.length === 0 ||
      warehousesMaster.length === 0 ||
      bins.length === 0
    ) {
      void loadStorageMasters();
    }
  }

  async function submitStockOperation(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const quantity = Number(operationQuantity);

    if (!operationItemId) {
      setError("Item is required.");
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }

    if (operationForm === "opening" || operationForm === "adjustment") {
      if (!operationWarehouseId) {
        setError("Warehouse is required.");
        return;
      }
    }

    if (operationForm === "transfer") {
      if (!sourceWarehouseId || !destinationWarehouseId) {
        setError("Source and destination warehouses are required.");
        return;
      }

      if (
        sourceWarehouseId === destinationWarehouseId &&
        (sourceBinId || "") === (destinationBinId || "")
      ) {
        setError("Source and destination cannot be the same location.");
        return;
      }
    }

    let url = "";
    let body: Record<string, unknown> = {};

    if (operationForm === "opening") {
      url = `${API}/api/stock/opening`;
      body = {
        itemId: operationItemId,
        warehouseId: operationWarehouseId,
        binId: operationBinId || undefined,
        quantity,
        notes: operationNotes.trim() || undefined,
      };
    }

    if (operationForm === "adjustment") {
      url = `${API}/api/stock/adjustment`;
      body = {
        itemId: operationItemId,
        warehouseId: operationWarehouseId,
        binId: operationBinId || undefined,
        quantity,
        notes: operationNotes.trim() || undefined,
      };
    }

    if (operationForm === "transfer") {
      url = `${API}/api/stock/transfer`;
      body = {
        itemId: operationItemId,
        sourceWarehouseId,
        sourceBinId: sourceBinId || undefined,
        destinationWarehouseId,
        destinationBinId: destinationBinId || undefined,
        quantity,
        notes: operationNotes.trim() || undefined,
      };
    }

    if (!url) {
      setError("Select a stock operation.");
      return;
    }

    setOperationSaving(true);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to complete stock operation"),
        );
      }

      resetOperationForm();
      await onRefresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to complete stock operation",
      );
    } finally {
      setOperationSaving(false);
    }
  }

  async function loadStorageMasters() {
    if (!token) return;

    setLoadingMasters(true);
    setError("");

    try {
      const headers = {
        Authorization: `Bearer ${token}`,
      };

      const [
        locationsResponse,
        warehousesResponse,
        zonesResponse,
        binsResponse,
      ] = await Promise.all([
        fetch(`${API}/api/locations`, { headers }),
        fetch(`${API}/api/warehouses`, { headers }),
        fetch(`${API}/api/warehouse-zones`, { headers }),
        fetch(`${API}/api/warehouse-bins`, { headers }),
      ]);

      const [
        locationsResult,
        warehousesResult,
        zonesResult,
        binsResult,
      ] = await Promise.all([
        locationsResponse.json(),
        warehousesResponse.json(),
        zonesResponse.json(),
        binsResponse.json(),
      ]);

      if (!locationsResponse.ok) {
        throw new Error(
          apiError(locationsResult, "Unable to load locations"),
        );
      }

      if (!warehousesResponse.ok) {
        throw new Error(
          apiError(warehousesResult, "Unable to load warehouses"),
        );
      }

      if (!zonesResponse.ok) {
        throw new Error(
          apiError(zonesResult, "Unable to load warehouse zones"),
        );
      }

      if (!binsResponse.ok) {
        throw new Error(
          apiError(binsResult, "Unable to load warehouse bins"),
        );
      }

      setLocations(locationsResult.data ?? []);
      setWarehousesMaster(warehousesResult.data ?? []);
      setZones(zonesResult.data ?? []);
      setBins(binsResult.data ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load storage masters",
      );
    } finally {
      setLoadingMasters(false);
    }
  }

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

  function openStorageForm(
    form: "location" | "warehouse" | "zone" | "bin",
  ) {
    setError("");
    setStorageForm(form);

    if (
      locations.length === 0 ||
      warehousesMaster.length === 0 ||
      zones.length === 0 ||
      bins.length === 0
    ) {
      void loadStorageMasters();
    }
  }

  function resetStorageForm() {
    setStorageForm("");
    setLocationCode("");
    setLocationName("");
    setWarehouseCode("");
    setWarehouseName("");
    setWarehouseLocationId("");
    setZoneCode("");
    setZoneName("");
    setZoneWarehouseId("");
    setBinCode("");
    setBinName("");
    setBinZoneId("");
  }

  async function createStorageRecord(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setStorageSaving(true);

    try {
      let url = "";
      let body: Record<string, unknown> = {};

      if (storageForm === "location") {
        if (!locationCode.trim() || !locationName.trim()) {
          throw new Error("Location code and name are required.");
        }

        url = `${API}/api/locations`;
        body = {
          code: locationCode.trim(),
          name: locationName.trim(),
        };
      }

      if (storageForm === "warehouse") {
        if (
          !warehouseCode.trim() ||
          !warehouseName.trim() ||
          !warehouseLocationId
        ) {
          throw new Error(
            "Warehouse code, name and location are required.",
          );
        }

        url = `${API}/api/warehouses`;
        body = {
          code: warehouseCode.trim(),
          name: warehouseName.trim(),
          locationId: warehouseLocationId,
        };
      }

      if (storageForm === "zone") {
        if (
          !zoneCode.trim() ||
          !zoneName.trim() ||
          !zoneWarehouseId
        ) {
          throw new Error(
            "Zone code, name and warehouse are required.",
          );
        }

        url = `${API}/api/warehouse-zones`;
        body = {
          code: zoneCode.trim(),
          name: zoneName.trim(),
          warehouseId: zoneWarehouseId,
        };
      }

      if (storageForm === "bin") {
        if (!binCode.trim() || !binName.trim() || !binZoneId) {
          throw new Error(
            "Bin code, name and zone are required.",
          );
        }

        url = `${API}/api/warehouse-bins`;
        body = {
          code: binCode.trim(),
          name: binName.trim(),
          zoneId: binZoneId,
        };
      }

      if (!url) {
        throw new Error("Select a storage record type.");
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to create storage record"),
        );
      }

      resetStorageForm();
      await loadStorageMasters();
      await onRefresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create storage record",
      );
    } finally {
      setStorageSaving(false);
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

            {activeTab === "operations" && (
              <div className="button-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openOperationForm("opening")}
                >
                  + Opening Stock
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openOperationForm("adjustment")}
                >
                  + Adjustment
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => openOperationForm("transfer")}
                >
                  + Transfer
                </button>
              </div>
            )}

            {activeTab === "storage" && (
              <div className="button-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openStorageForm("location")}
                >
                  + Location
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openStorageForm("warehouse")}
                >
                  + Warehouse
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openStorageForm("zone")}
                >
                  + Zone
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => openStorageForm("bin")}
                >
                  + Bin
                </button>
              </div>
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

            <button
              type="button"
              className={
                activeTab === "storage" ? "tab active" : "tab"
              }
              onClick={() => {
                setActiveTab("storage");
                void loadStorageMasters();
              }}
            >
              Storage
            </button>

            <button
              type="button"
              className={
                activeTab === "operations" ? "tab active" : "tab"
              }
              onClick={() => {
                setActiveTab("operations");
                void loadStorageMasters();
              }}
            >
              Operations
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

        {activeTab === "operations" && operationForm && (
          <form
            className="form-grid create-form"
            onSubmit={submitStockOperation}
          >
            <div className="form-section-heading">
              <div className="eyebrow">STOCK OPERATIONS</div>
              <h3>
                {operationForm === "opening"
                  ? "Opening Stock"
                  : operationForm === "adjustment"
                    ? "Stock Adjustment"
                    : "Stock Transfer"}
              </h3>
            </div>

            <label>
              Item
              <select
                value={operationItemId}
                onChange={(event) =>
                  setOperationItemId(event.target.value)
                }
                required
              >
                <option value="">Select item</option>
                {items
                  .filter((item) => item.active !== false)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} — {item.name}
                    </option>
                  ))}
              </select>
            </label>

            {operationForm !== "transfer" ? (
              <>
                <label>
                  Warehouse
                  <select
                    value={operationWarehouseId}
                    onChange={(event) => {
                      setOperationWarehouseId(event.target.value);
                      setOperationBinId("");
                    }}
                    required
                  >
                    <option value="">Select warehouse</option>
                    {warehousesMaster
                      .filter((warehouse) => warehouse.active !== false)
                      .map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.code} — {warehouse.name}
                        </option>
                      ))}
                  </select>
                </label>

                <label>
                  Bin
                  <select
                    value={operationBinId}
                    onChange={(event) =>
                      setOperationBinId(event.target.value)
                    }
                    disabled={!operationWarehouseId}
                  >
                    <option value="">Warehouse level</option>
                    {binsForWarehouse(operationWarehouseId).map((bin) => (
                      <option key={bin.id} value={bin.id}>
                        {bin.code} — {bin.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Source Warehouse
                  <select
                    value={sourceWarehouseId}
                    onChange={(event) => {
                      setSourceWarehouseId(event.target.value);
                      setSourceBinId("");
                    }}
                    required
                  >
                    <option value="">Select source warehouse</option>
                    {warehousesMaster
                      .filter((warehouse) => warehouse.active !== false)
                      .map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.code} — {warehouse.name}
                        </option>
                      ))}
                  </select>
                </label>

                <label>
                  Source Bin
                  <select
                    value={sourceBinId}
                    onChange={(event) =>
                      setSourceBinId(event.target.value)
                    }
                    disabled={!sourceWarehouseId}
                  >
                    <option value="">Warehouse level</option>
                    {binsForWarehouse(sourceWarehouseId).map((bin) => (
                      <option key={bin.id} value={bin.id}>
                        {bin.code} — {bin.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Destination Warehouse
                  <select
                    value={destinationWarehouseId}
                    onChange={(event) => {
                      setDestinationWarehouseId(event.target.value);
                      setDestinationBinId("");
                    }}
                    required
                  >
                    <option value="">Select destination warehouse</option>
                    {warehousesMaster
                      .filter((warehouse) => warehouse.active !== false)
                      .map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.code} — {warehouse.name}
                        </option>
                      ))}
                  </select>
                </label>

                <label>
                  Destination Bin
                  <select
                    value={destinationBinId}
                    onChange={(event) =>
                      setDestinationBinId(event.target.value)
                    }
                    disabled={!destinationWarehouseId}
                  >
                    <option value="">Warehouse level</option>
                    {binsForWarehouse(destinationWarehouseId).map((bin) => (
                      <option key={bin.id} value={bin.id}>
                        {bin.code} — {bin.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            <label>
              Quantity
              <input
                type="number"
                min="0.0001"
                step="any"
                value={operationQuantity}
                onChange={(event) =>
                  setOperationQuantity(event.target.value)
                }
                placeholder="0.00"
                required
              />
            </label>

            <label>
              Notes
              <input
                value={operationNotes}
                onChange={(event) =>
                  setOperationNotes(event.target.value)
                }
                placeholder="Optional notes"
              />
            </label>

            <div
              style={{
                display: "flex",
                alignItems: "end",
                gap: "8px",
              }}
            >
              <button
                type="submit"
                className="primary-button"
                disabled={operationSaving}
              >
                {operationSaving ? "Saving..." : "Complete Operation"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={resetOperationForm}
                disabled={operationSaving}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {activeTab === "storage" && storageForm && (
          <form
            className="form-grid create-form"
            onSubmit={createStorageRecord}
          >
            {storageForm === "location" && (
              <>
                <label>
                  Location Code
                  <input
                    value={locationCode}
                    onChange={(event) =>
                      setLocationCode(event.target.value)
                    }
                    placeholder="LOC-001"
                    required
                  />
                </label>
                <label>
                  Location Name
                  <input
                    value={locationName}
                    onChange={(event) =>
                      setLocationName(event.target.value)
                    }
                    placeholder="Main Site"
                    required
                  />
                </label>
              </>
            )}

            {storageForm === "warehouse" && (
              <>
                <label>
                  Warehouse Code
                  <input
                    value={warehouseCode}
                    onChange={(event) =>
                      setWarehouseCode(event.target.value)
                    }
                    placeholder="WH-001"
                    required
                  />
                </label>
                <label>
                  Warehouse Name
                  <input
                    value={warehouseName}
                    onChange={(event) =>
                      setWarehouseName(event.target.value)
                    }
                    placeholder="Main Warehouse"
                    required
                  />
                </label>
                <label>
                  Location
                  <select
                    value={warehouseLocationId}
                    onChange={(event) =>
                      setWarehouseLocationId(event.target.value)
                    }
                    required
                  >
                    <option value="">Select location</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.code} — {location.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {storageForm === "zone" && (
              <>
                <label>
                  Zone Code
                  <input
                    value={zoneCode}
                    onChange={(event) =>
                      setZoneCode(event.target.value)
                    }
                    placeholder="ZONE-A"
                    required
                  />
                </label>
                <label>
                  Zone Name
                  <input
                    value={zoneName}
                    onChange={(event) =>
                      setZoneName(event.target.value)
                    }
                    placeholder="Receiving"
                    required
                  />
                </label>
                <label>
                  Warehouse
                  <select
                    value={zoneWarehouseId}
                    onChange={(event) =>
                      setZoneWarehouseId(event.target.value)
                    }
                    required
                  >
                    <option value="">Select warehouse</option>
                    {warehousesMaster.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.code} — {warehouse.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {storageForm === "bin" && (
              <>
                <label>
                  Bin Code
                  <input
                    value={binCode}
                    onChange={(event) =>
                      setBinCode(event.target.value)
                    }
                    placeholder="BIN-001"
                    required
                  />
                </label>
                <label>
                  Bin Name
                  <input
                    value={binName}
                    onChange={(event) =>
                      setBinName(event.target.value)
                    }
                    placeholder="Receiving Bin"
                    required
                  />
                </label>
                <label>
                  Zone
                  <select
                    value={binZoneId}
                    onChange={(event) =>
                      setBinZoneId(event.target.value)
                    }
                    required
                  >
                    <option value="">Select zone</option>
                    {zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.code} — {zone.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            <div style={{ display: "flex", alignItems: "end", gap: "8px" }}>
              <button
                type="submit"
                className="primary-button"
                disabled={storageSaving || loadingMasters}
              >
                {storageSaving ? "Creating..." : "Create"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={resetStorageForm}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {activeTab === "operations" ? (
          <div className="operations-grid">
            <div className="card">
              <span>Opening Stock</span>
              <strong>Initialize</strong>
              <p>
                Create the first stock balance for an item and storage
                location.
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => openOperationForm("opening")}
              >
                Start Opening Stock
              </button>
            </div>

            <div className="card">
              <span>Stock Adjustment</span>
              <strong>Increase / Decrease</strong>
              <p>
                Correct an existing stock balance with a controlled
                adjustment.
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => openOperationForm("adjustment")}
              >
                Start Adjustment
              </button>
            </div>

            <div className="card">
              <span>Stock Transfer</span>
              <strong>Move Inventory</strong>
              <p>
                Transfer stock between warehouses or bins.
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => openOperationForm("transfer")}
              >
                Start Transfer
              </button>
            </div>
          </div>
        ) : activeTab === "storage" ? (
          <div className="storage-grid">
            <div>
              <div className="panel-header">
                <div>
                  <h2>Locations</h2>
                  <p>Physical locations containing warehouses.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>City</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((location) => (
                      <tr key={location.id}>
                        <td><strong>{location.code}</strong></td>
                        <td>{location.name}</td>
                        <td>{location.city ?? "—"}</td>
                        <td>
                          <span className="status active">
                            {location.active === false ? "DISABLED" : "ACTIVE"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {locations.length === 0 && (
                      <tr>
                        <td colSpan={4}>
                          <div className="empty">No locations found.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="panel-header">
                <div>
                  <h2>Warehouses</h2>
                  <p>Inventory storage facilities by location.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Location</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warehousesMaster.map((warehouse) => (
                      <tr key={warehouse.id}>
                        <td><strong>{warehouse.code}</strong></td>
                        <td>{warehouse.name}</td>
                        <td>
                          {warehouse.location?.name ??
                            warehouse.location?.code ??
                            "—"}
                        </td>
                        <td>{warehouse.warehouseType ?? "STANDARD"}</td>
                      </tr>
                    ))}
                    {warehousesMaster.length === 0 && (
                      <tr>
                        <td colSpan={4}>
                          <div className="empty">No warehouses found.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="panel-header">
                <div>
                  <h2>Zones</h2>
                  <p>Logical warehouse storage areas.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Warehouse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zones.map((zone) => (
                      <tr key={zone.id}>
                        <td><strong>{zone.code}</strong></td>
                        <td>{zone.name}</td>
                        <td>
                          {zone.warehouse?.name ??
                            zone.warehouse?.code ??
                            "—"}
                        </td>
                      </tr>
                    ))}
                    {zones.length === 0 && (
                      <tr>
                        <td colSpan={3}>
                          <div className="empty">No zones found.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="panel-header">
                <div>
                  <h2>Bins</h2>
                  <p>Specific storage positions within zones.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Zone</th>
                      <th>Warehouse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bins.map((bin) => (
                      <tr key={bin.id}>
                        <td><strong>{bin.code}</strong></td>
                        <td>{bin.name}</td>
                        <td>
                          {bin.zone?.name ??
                            bin.zone?.code ??
                            "—"}
                        </td>
                        <td>
                          {bin.zone?.warehouse?.name ??
                            bin.zone?.warehouse?.code ??
                            "—"}
                        </td>
                      </tr>
                    ))}
                    {bins.length === 0 && (
                      <tr>
                        <td colSpan={4}>
                          <div className="empty">No bins found.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : activeTab === "items" ? (
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
