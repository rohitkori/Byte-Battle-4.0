# Analytics Schema

Database: `anarock_analytics` (alias: `analytics`)

> Marketing data exists in **both** this database and `digix`. Use `analytics` for spends tracking, daily metrics, ad account configs. Use `digix` for raw FB/Google data and page integrations.

## Table Relationships

```
assignments (from leads DB, referenced by ID)
    ├── ad_spends_config (source/subsource spend configs)
    │       └── spends_sheet (daily spend records)
    ├── assignment_properties (meta: agency_name, ad accounts, budgets)
    ├── dailymetrics (daily lead/channel aggregates)
    ├── audiences → audience_platform_mappings
    └── ad_transfers / ad_invoices / ad_po (financial tracking)
```

---

## ad_spends_config

Defines spend tracking configs per assignment/source/subsource.

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `assignment_id` | integer | FK to leads DB assignments |
| `channel` | varchar | 'online', etc. |
| `source` | varchar | 'facebook', 'google', etc. |
| `subsource` | varchar | Specific subsource identifier |
| `status` | varchar | 'active', 'inactive' |
| `created_at` | timestamp | Creation time |

```sql
SELECT * FROM ad_spends_config WHERE assignment_id = $1 ORDER BY created_at DESC;
```

---

## spends_sheet

Daily spend records linked to ad_spends_config.

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `config_id` | integer | FK to ad_spends_config |
| `assignment_id` | integer | FK to assignments |
| `date` | date | Spend date |
| `spends` | numeric | Amount spent |
| `spends_key` | varchar | Spend identifier |
| `auto` | varchar | 'facebook', 'google', or null for manual |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update |

```sql
-- Spends by source for an assignment
SELECT sc.source, sc.subsource, sum(ss.spends) total, min(ss.date) min_date, max(ss.date) max_date
FROM spends_sheet ss
JOIN ad_spends_config sc ON sc.id = ss.config_id
WHERE sc.assignment_id = $1
GROUP BY sc.source, sc.subsource ORDER BY total DESC;

-- Daily spends trend
SELECT date, sum(spends) FROM spends_sheet
WHERE config_id = $1 ORDER BY date DESC LIMIT 30;

-- Detect backfilled/updated spends
SELECT config_id, sum(spends), min(date), max(date)
FROM spends_sheet WHERE updated_at::date = CURRENT_DATE AND date < CURRENT_DATE - 30
GROUP BY 1 ORDER BY sum(spends) DESC;
```

---

## assignment_properties

Per-assignment configuration and metadata.

| Column | Type | Description |
|--------|------|-------------|
| `assignment_id` | integer | FK to assignments |
| `meta` | jsonb/text | Rich metadata object |

### Key meta paths:
| Path | Description |
|------|-------------|
| `meta->>'agency_name'` | 'anarock digital', etc. |
| `meta->>'facebook_account_id'` | FB ad account ID |
| `meta->>'adwords_account_id'` | Google Ads account ID (comma-separated) |
| `meta->>'ad_budget'` | Agreed ad budget |
| `meta->>'ad_commision'` | Commission percentage |
| `meta->>'ad_start_date'` | Ad campaign start |
| `meta->>'ad_end_date'` | Ad campaign end |
| `meta->>'approver'` | Budget approver |
| `meta->>'ad_account_type'` | 'client_credit_line', etc. |
| `meta->'commision_block'` | JSONB array of commission rules |
| `meta->'spends_block'` | JSONB array of spend rules |
| `meta->'services'` | PO services array |

```sql
-- All digital assignments with FB accounts
SELECT ap.assignment_id, a.name, ap.meta->>'facebook_account_id' as fb_account
FROM assignment_properties ap
JOIN assignments a ON a.id = ap.assignment_id
WHERE meta->>'facebook_account_id' IS NOT NULL
  AND lower(ap.meta->>'agency_name') IN ('anarock digital', 'anarockdigital');
```

---

## dailymetrics

Daily aggregated metrics per assignment/channel.

| Column | Type | Description |
|--------|------|-------------|
| `assignment_id` | integer | FK to assignments |
| `date` | date | Metric date |
| `lead_channel` | varchar | 'facebook', 'google', etc. |
| `created_at` | timestamp | Creation time |

```sql
SELECT * FROM dailymetrics
WHERE assignment_id = $1 AND lead_channel = 'facebook' AND date = '2024-11-21';
```

---

## audiences / audience_platform_mappings

| Column | Type | Description |
|--------|------|-------------|
| `audiences.id` | integer | PK |
| `audiences.name` | varchar | Audience name |
| `audiences.created_by` | varchar | Creator email |
| `audiences.total_count` | integer | Audience size |
| `audiences.assignment_id` | integer | FK to assignments |
| `audiences.project_id` | integer | FK to ASEM |
| `audience_platform_mappings.audience_id` | integer | FK to audiences |
| `audience_platform_mappings.platform` | varchar | 'FACEBOOK', 'GOOGLE', 'WHATSAPP', 'AI2WAYCALLING', 'F2F' |
| `audience_platform_mappings.matched_count` | integer | Matched audience count |
| `audience_platform_mappings.campaign_count` | integer | Campaigns using this |
| `audience_platform_mappings.campaigns_dict` | jsonb | Platform-campaign mapping |

---

## Financial Tables

### ad_transfers
| Column | Type | Description |
|--------|------|-------------|
| `assignment_id` | integer | FK to assignments |
| `amount` | numeric | Transfer amount |
| `date` | date | Transfer date |
| `meta` | jsonb | `->>'invoice_id'` for invoice link |

### ad_invoices
| Column | Type | Description |
|--------|------|-------------|
| `assignment_id` | integer | FK to assignments |
| `invoice_id` | varchar | Invoice identifier |
| `amount` | numeric | Invoice amount |
| `date` | date | Invoice date |

### ad_po (Purchase Orders)
| Column | Type | Description |
|--------|------|-------------|
| `assignment_id` | integer | FK to assignments |
| `meta` | jsonb | `->>'canceled'`, `->>'adjusted'`, `->'services'` (JSON array with rate/unit_price), `->'order_date'` |
| `date` | date | PO date |

```sql
-- PO amounts
SELECT id, assignment_id, (meta->>'adjusted')::int adjusted,
       sum((service->>'rate')::float * (service->>'unit_price')::float) amount
FROM (
  SELECT id, assignment_id, meta, json_array_elements(meta->'services') service
  FROM ad_po WHERE NOT coalesce(meta->>'canceled', 'f')::boolean
) foo
GROUP BY 1, 2, 3;
```

---

## Other Tables

| Table | Usage |
|-------|-------|
| `sql_queries` | Saved SQL queries (`status = 'active'`) |
| `manual_spends_logs` | Manual spend upload logs |
| `adsets` | Ad set configurations |
