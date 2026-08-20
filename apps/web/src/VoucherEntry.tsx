import React, { useState } from 'react';

export default function VoucherEntry() {
  const [lines, setLines] = useState([{ accountId: '', debit: '', credit: '' }]);
  const [narration, setNarration] = useState('');

  function addLine() {
    setLines([...lines, { accountId: '', debit: '', credit: '' }]);
  }

  function updateLine(i: number, key: string, value: string) {
    const copy = [...lines];
    // @ts-ignore
    copy[i][key] = value;
    setLines(copy);
  }

  async function saveDraft() {
    const payload = {
      organizationId: 'org-1',
      voucherTypeId: 'vt-1',
      voucherDate: new Date().toISOString().split('T')[0],
      narration,
      lines: lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })),
    };

    const res = await fetch('/api/accounting/vouchers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    alert('Saved: ' + (data?.data?.voucherNumber ?? 'unknown'));
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Voucher Entry (minimal)</h2>
      <div>
        <label>Narration:</label>
        <input value={narration} onChange={(e) => setNarration(e.target.value)} />
      </div>
      <table>
        <thead>
          <tr>
            <th>AccountId</th>
            <th>Debit</th>
            <th>Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td>
                <input value={line.accountId} onChange={(e) => updateLine(i, 'accountId', e.target.value)} />
              </td>
              <td>
                <input value={line.debit} onChange={(e) => updateLine(i, 'debit', e.target.value)} />
              </td>
              <td>
                <input value={line.credit} onChange={(e) => updateLine(i, 'credit', e.target.value)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addLine}>Add line</button>
      <button onClick={saveDraft}>Save draft</button>
    </div>
  );
}
