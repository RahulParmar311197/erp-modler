import { useMemo, useState } from "react";
import type { FormEvent } from "react";

type GlAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
};

type JournalLine = {
  id?: string;
  accountId: string;
  debit: number | string;
  credit: number | string;
  description?: string | null;
  account?: GlAccount | null;
};

type JournalEntry = {
  id: string;
  entryNumber: string;
  entryDate: string;
  description?: string | null;
  status: string;
  sourceType?: string | null;
  sourceId?: string | null;
  lines?: JournalLine[];
};

type JournalEntriesPageProps = {
  token: string;
  glAccounts: GlAccount[];
  journalEntries: JournalEntry[];
  onRefresh: () => Promise<void>;
};

const API = "";

type DraftLine = {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
};

const emptyLine = (): DraftLine => ({
  accountId: "",
  debit: "",
  credit: "",
  description: "",
});

function money(value: number | string) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

export function JournalEntriesPage({
  token,
  glAccounts,
  journalEntries,
  onRefresh,
}: JournalEntriesPageProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");

  const [entryNumber, setEntryNumber] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    emptyLine(),
    emptyLine(),
  ]);

  const totals = useMemo(() => {
    const debit = lines.reduce(
      (sum, line) => sum + Number(line.debit || 0),
      0,
    );
    const credit = lines.reduce(
      (sum, line) => sum + Number(line.credit || 0),
      0,
    );

    return {
      debit,
      credit,
      difference: debit - credit,
    };
  }, [lines]);

  const postedCount = journalEntries.filter(
    (entry) => entry.status === "POSTED",
  ).length;

  const draftCount = journalEntries.filter(
    (entry) => entry.status === "DRAFT",
  ).length;

  function updateLine(
    index: number,
    field: keyof DraftLine,
    value: string,
  ) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              [field]: value,
              ...(field === "debit" && value
                ? { credit: "" }
                : {}),
              ...(field === "credit" && value
                ? { debit: "" }
                : {}),
            }
          : line,
      ),
    );
  }

  function addLine() {
    setLines((current) => [...current, emptyLine()]);
  }

  function removeLine(index: number) {
    if (lines.length <= 2) return;
    setLines((current) =>
      current.filter((_, lineIndex) => lineIndex !== index),
    );
  }

  function resetForm() {
    setEntryNumber("");
    setEntryDate("");
    setDescription("");
    setLines([emptyLine(), emptyLine()]);
    setError("");
  }

  async function createEntry(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (!entryNumber.trim()) {
      setError("Entry number is required.");
      return;
    }

    if (lines.length < 2) {
      setError("At least two journal lines are required.");
      return;
    }

    if (Math.abs(totals.difference) > 0.000001) {
      setError("Journal entry must be balanced before saving.");
      return;
    }

    const payloadLines = lines.map((line) => ({
      accountId: line.accountId,
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      description: line.description.trim() || undefined,
    }));

    if (
      payloadLines.some(
        (line) =>
          !line.accountId ||
          (line.debit <= 0 && line.credit <= 0) ||
          (line.debit > 0 && line.credit > 0),
      )
    ) {
      setError(
        "Every line requires an account and exactly one positive debit or credit.",
      );
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API}/api/gl/journal-entries`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entryNumber: entryNumber.trim(),
          entryDate: entryDate || undefined,
          description: description.trim() || undefined,
          lines: payloadLines,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.errors?.[0]?.message ??
            "Unable to create journal entry",
        );
      }

      resetForm();
      setShowCreate(false);
      await onRefresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create journal entry",
      );
    } finally {
      setSaving(false);
    }
  }

  async function performAction(
    entry: JournalEntry,
    action: "post" | "reverse" | "void",
  ) {
    setError("");
    setActionId(`${entry.id}:${action}`);

    try {
      const response = await fetch(
        `${API}/api/gl/journal-entries/${entry.id}/${action}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.errors?.[0]?.message ??
            `Unable to ${action} journal entry`,
        );
      }

      await onRefresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Unable to ${action} journal entry`,
      );
    } finally {
      setActionId("");
    }
  }

  async function reverse(entry: JournalEntry) {
    if (
      !window.confirm(
        `Reverse journal entry ${entry.entryNumber}?`,
      )
    ) {
      return;
    }

    await performAction(entry, "reverse");
  }

  async function voidEntry(entry: JournalEntry) {
    if (
      !window.confirm(
        `Void journal entry ${entry.entryNumber}?`,
      )
    ) {
      return;
    }

    await performAction(entry, "void");
  }

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">ACCOUNTING</div>
            <h2>Journal Entries</h2>
            <p>
              Create, post, reverse and void accounting journals.
            </p>
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setShowCreate((value) => !value);
              setError("");
            }}
          >
            {showCreate ? "Close" : "+ New Journal Entry"}
          </button>
        </div>

        <div className="cards">
          <div className="card">
            <span>Total Entries</span>
            <strong>{journalEntries.length}</strong>
          </div>

          <div className="card">
            <span>Draft</span>
            <strong>{draftCount}</strong>
          </div>

          <div className="card">
            <span>Posted</span>
            <strong>{postedCount}</strong>
          </div>

          <div className="card">
            <span>GL Accounts</span>
            <strong>{glAccounts.length}</strong>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
      </section>

      {showCreate && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>New Journal Entry</h2>
              <p>
                The entry must contain balanced debit and credit lines.
              </p>
            </div>
          </div>

          <form className="create-form" onSubmit={createEntry}>
            <div className="form-grid">
              <label>
                Entry Number
                <input
                  value={entryNumber}
                  onChange={(event) =>
                    setEntryNumber(event.target.value)
                  }
                  placeholder="JE-0001"
                />
              </label>

              <label>
                Entry Date
                <input
                  type="date"
                  value={entryDate}
                  onChange={(event) =>
                    setEntryDate(event.target.value)
                  }
                />
              </label>

              <label>
                Description
                <input
                  value={description}
                  onChange={(event) =>
                    setDescription(event.target.value)
                  }
                  placeholder="Journal description"
                />
              </label>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Description</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th />
                  </tr>
                </thead>

                <tbody>
                  {lines.map((line, index) => (
                    <tr key={index}>
                      <td>
                        <select
                          value={line.accountId}
                          onChange={(event) =>
                            updateLine(
                              index,
                              "accountId",
                              event.target.value,
                            )
                          }
                        >
                          <option value="">Select account</option>
                          {glAccounts.map((account) => (
                            <option
                              key={account.id}
                              value={account.id}
                            >
                              {account.code} — {account.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td>
                        <input
                          value={line.description}
                          onChange={(event) =>
                            updateLine(
                              index,
                              "description",
                              event.target.value,
                            )
                          }
                          placeholder="Line description"
                        />
                      </td>

                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.debit}
                          onChange={(event) =>
                            updateLine(
                              index,
                              "debit",
                              event.target.value,
                            )
                          }
                        />
                      </td>

                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.credit}
                          onChange={(event) =>
                            updateLine(
                              index,
                              "credit",
                              event.target.value,
                            )
                          }
                        />
                      </td>

                      <td>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => removeLine(index)}
                          disabled={lines.length <= 2}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel-header">
              <div>
                <strong>Debit: {money(totals.debit)}</strong>
                {" · "}
                <strong>Credit: {money(totals.credit)}</strong>
                {" · "}
                <strong>
                  Difference: {money(totals.difference)}
                </strong>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={addLine}
              >
                + Add Line
              </button>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  resetForm();
                  setShowCreate(false);
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Draft"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Journal Register</h2>
            <p>Accounting transactions and journal lifecycle.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Entry</th>
                <th>Date</th>
                <th>Description</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {journalEntries.map((entry) => {
                const debit = (entry.lines ?? []).reduce(
                  (sum, line) => sum + Number(line.debit || 0),
                  0,
                );

                const credit = (entry.lines ?? []).reduce(
                  (sum, line) => sum + Number(line.credit || 0),
                  0,
                );

                const busy = actionId.startsWith(`${entry.id}:`);

                return (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.entryNumber}</strong>
                    </td>

                    <td>
                      {new Date(
                        entry.entryDate,
                      ).toLocaleDateString("en-IN")}
                    </td>

                    <td>{entry.description || "—"}</td>

                    <td>{money(debit)}</td>
                    <td>{money(credit)}</td>

                    <td>
                      <span
                        className={`status ${entry.status.toLowerCase()}`}
                      >
                        {entry.status.replaceAll("_", " ")}
                      </span>
                    </td>

                    <td>
                      <div className="modal-actions">
                        {entry.status === "DRAFT" && (
                          <button
                            type="button"
                            className="primary-button"
                            disabled={busy}
                            onClick={() =>
                              void performAction(entry, "post")
                            }
                          >
                            {busy ? "Working..." : "Post"}
                          </button>
                        )}

                        {entry.status === "POSTED" && (
                          <>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busy}
                              onClick={() => void reverse(entry)}
                            >
                              Reverse
                            </button>

                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busy}
                              onClick={() => void voidEntry(entry)}
                            >
                              Void
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {journalEntries.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">
                      No journal entries found.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
