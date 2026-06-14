# Finance (Plutus) Schema

Complete schema for financial and accounting tables.

> **⚠️ Rarely Used:** Most financial data (invoices, collections) is in `leads` DB. This database is seldom queried.

## Database

Alias: `finance`

## Discovering Tables

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

## Expected Tables

### Invoicing
- invoices
- invoice_items
- invoice_templates
- credit_notes

### Ledger & Accounting
- ledger_entries
- accounts
- journals
- journal_entries

### Collections
- collections
- payment_receipts
- collection_reconciliations

### Payouts
- payout_records
- payout_schedules
- beneficiary_details

### Tax & Compliance
- tax_records
- gst_entries
- tds_deductions

> **TODO:** Populate with full table documentation.
