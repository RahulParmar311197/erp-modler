import React, { useState } from 'react';

export default function VendorPaymentEntry() {
  const [vendorBillId, setVendorBillId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [amount, setAmount] = useState('');

  async function payVendor() {
    const payload = { vendorBillId, bankAccountId, amount: Number(amount) };
    const res = await fetch('/api/purchasing/vendor-payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    alert('Payment Created: ' + (data?.data?.paymentNumber ?? data?.data?.id ?? 'unknown'));
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Vendor Payment (minimal)</h2>
      <div>
        <label>VendorBillId:</label>
        <input value={vendorBillId} onChange={(e) => setVendorBillId(e.target.value)} />
      </div>
      <div>
        <label>BankAccountId:</label>
        <input value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} />
      </div>
      <div>
        <label>Amount:</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <button onClick={payVendor}>Pay</button>
    </div>
  );
}
