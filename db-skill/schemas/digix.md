# Digix Schema

Alias: `digix`

> Marketing data exists in **both** this database and `analytics`. Use `digix` for raw FB/Google data, page integrations, leadgen. Use `analytics` for aggregated spends reports.

## Table Relationships

```
developers
    └── developer_page_link (page_token)
            └── fb_pages (page_id, page_name)
                    ├── fb_forms → fb_form_configs → fb_leadgen
                    ├── fb_comments (via entity_conversation_integrations)
                    ├── comment_page_integration_info
                    └── fb_page_instagram_account_mappings

fb_ad_report (campaign-level daily data by ad_id)
fb_spends (campaign-level daily aggregates)
adwords_ad_report (Google Ads data)
adwords_clicks (Google click tracking)

entity_conversation_integrations (FB/IG comment+message bot routing)
orphan_webhooks (unmatched FB/IG webhooks)
leadgen_pool (incoming leadgen queue)
```

---

## fb_pages

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Internal primary key |
| `page_id` | varchar | Facebook page ID (external) |
| `page_name` | varchar | Page name |
| `status` | varchar | 'on'/'off' |
| `created_at` | timestamp | Creation time |

```sql
SELECT id, page_id, page_name FROM fb_pages WHERE page_name ILIKE '%keyword%';
SELECT * FROM fb_pages WHERE page_id = '198238383366138';
```

---

## developer_page_link

Links developers to FB pages with encrypted tokens.

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `developer_id` | integer | FK to developers |
| `page_id` | integer | FK to fb_pages.id (internal!) |
| `page_token` | text | Encrypted page access token |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update |

```sql
-- Find tokens for a FB page
SELECT dpl.*, d.name dev_name
FROM developer_page_link dpl
JOIN developers d ON d.id = dpl.developer_id
WHERE dpl.page_id = (SELECT id FROM fb_pages WHERE page_id = '$FB_PAGE_ID')
ORDER BY dpl.updated_at DESC;
```

---

## fb_leadgen

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `leadgen_id` | varchar | Facebook leadgen ID |
| `lead_id` | integer | FK to leads DB leads.id |
| `form_id` | varchar | Facebook form ID |
| `page_id` | varchar | Facebook page ID (external) |
| `status` | varchar | 'DONE', etc. |
| `inquiries_count` | integer | Number of inquiries created |
| `created_at` | timestamp | Creation time |

```sql
SELECT id, leadgen_id, lead_id, status, created_at
FROM fb_leadgen WHERE page_id = '$PAGE_ID' ORDER BY created_at DESC LIMIT 10;

SELECT * FROM fb_leadgen WHERE lead_id = $LEAD_ID;
```

---

## fb_forms / fb_form_configs

```sql
-- Forms for a page
SELECT * FROM fb_forms WHERE page_id = (SELECT id FROM fb_pages WHERE page_id = '$FB_PAGE_ID');

-- Form config (mapping form to assignment/project)
SELECT ffc.* FROM fb_form_configs ffc
JOIN fb_forms ff ON ff.id = ffc.form_id
WHERE ff.form_id = '$FORM_ID';
```

---

## fb_spends

Daily campaign-level spend aggregates from Facebook.

| Column | Type | Description |
|--------|------|-------------|
| `account_id` | varchar | Ad account ID |
| `campaign` | varchar | Full campaign name (contains `#code-subsource`) |
| `date` | date | Spend date |
| `spends` | numeric | Amount spent |

```sql
-- Campaign spends
SELECT campaign, sum(spends), min(date) min_date, max(date) max_date
FROM fb_spends WHERE campaign ILIKE '%#code-subsource%'
GROUP BY campaign;
```

---

## fb_ad_report

Daily ad-level data from Facebook (more granular than fb_spends).

| Column | Type | Description |
|--------|------|-------------|
| `account_id` | varchar | Ad account ID |
| `campaign_name` | varchar | Campaign name |
| `ad_id` | varchar | Ad ID |
| `date` | date | Report date |
| `spends` | numeric | Amount spent |

```sql
-- Detect campaign renames (same ad_id, different campaign names)
SELECT ad_id, array_agg(DISTINCT campaign_name) renamed
FROM fb_ad_report WHERE account_id = '$ACCOUNT_ID'
GROUP BY ad_id HAVING count(DISTINCT campaign_name) > 1;
```

---

## adwords_ad_report / adwords_clicks

| Column | Notes |
|--------|-------|
| `adwords_ad_report."Ad ID"` | Quoted column names |
| `adwords_ad_report."Day"` | Date column |
| `adwords_ad_report."Cost"` | Spend in micros |
| `adwords_ad_report.account_id` | Google account |
| `adwords_clicks."Google Click ID"` | GCLID |
| `adwords_clicks.lead_id` | FK to leads |

```sql
SELECT sum("Cost") FROM adwords_ad_report
WHERE "Day" BETWEEN '2024-05-20' AND '2024-06-19' AND account_id = '177-577-9807';
```

---

## entity_conversation_integrations

Routes FB/IG comments and messages to bot agents.

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `entity_type` | varchar | 'FB_PAGE', 'INSTAGRAM_ACCOUNT' |
| `entity_id` | varchar | Page ID or IG account ID |
| `assignment_id` | integer | FK to leads DB assignments |
| `project_id` | integer | ASEM channel mapping ID |
| `agent_id` | integer | Bot agent ID |
| `status` | varchar | 'ON', 'OFF' |
| `action` | varchar | 'DELETE', 'HIDE' |
| `campaign_id` | varchar | Identifier string |
| `conversation_type` | varchar | 'COMMENT', 'MESSAGE' |

---

## orphan_webhooks

Stores unmatched/unprocessed FB and IG webhooks.

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `entity_type` | varchar | 'leadgen', 'misc_fb_entity' |
| `json_dump` | text | Raw JSON (cast to `::jsonb` for querying) |
| `created_at` | timestamp | Arrival time |

```sql
-- Find webhooks for a page
SELECT id, (json_dump::jsonb)->'entry'->0->>'id' as page_id
FROM orphan_webhooks
WHERE (json_dump::jsonb)->'entry'->0->>'id' = '$PAGE_ID'
ORDER BY created_at DESC LIMIT 10;

-- IG comment webhooks
SELECT * FROM orphan_webhooks
WHERE entity_type = 'misc_fb_entity'
  AND (json_dump::jsonb)->>'object' = 'instagram'
ORDER BY created_at DESC LIMIT 10;
```

---

## fb_comments

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `comment_id` | varchar | FB comment ID |
| `post_id` | varchar | FB post ID |
| `integration_id` | integer | FK to entity_conversation_integrations |
| `parent_id` | varchar | Parent comment ID |
| `content` | text | Comment text |
| `user_name` | varchar | Commenter name |
| `status` | varchar | 'HIDDEN', etc. |
| `lead_ids` | integer[] | Associated lead IDs |
| `created_at` | timestamp | Creation time |

---

## fb_page_instagram_account_mappings

| Column | Type | Description |
|--------|------|-------------|
| `fb_page_id` | varchar | Facebook page ID |
| `instagram_account_id` | varchar | IG business account ID |
