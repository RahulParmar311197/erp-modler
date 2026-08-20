import React, { useState } from 'react';

export default function CustomerPaymentEntry() {
  const [salesInvoiceId,setSalesInvoiceId]=useState('');
  const [bankAccountId,setBankAccountId]=useState('');
  const [amount,setAmount]=useState('');
  async function pay(){ const payload={ salesInvoiceId, bankAccountId, amount: Number(amount) }; const res=await fetch('/api/sales/customer-payments', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }); const data=await res.json(); alert('Payment Created: '+(data?.data?.paymentNumber ?? data?.data?.id ?? 'unknown')); }
  return (<div style={{padding:20}}><h2>Customer Payment (minimal)</h2><div><label>SalesInvoiceId:</label><input value={salesInvoiceId} onChange={(e)=>setSalesInvoiceId(e.target.value)} /></div><div><label>BankAccountId:</label><input value={bankAccountId} onChange={(e)=>setBankAccountId(e.target.value)} /></div><div><label>Amount:</label><input value={amount} onChange={(e)=>setAmount(e.target.value)} /></div><button onClick={pay}>Pay</button></div>);
}
