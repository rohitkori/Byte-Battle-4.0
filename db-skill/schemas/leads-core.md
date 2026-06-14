# Leads Core Schema

Most commonly used tables in the `leads` alias.

## Table Relationships

```
assignments (mandates)
    ├── assignment_supply_entity_mappings (asem) → supply_entities (projects) → cities
    │       └── assignment_supply_entity_mappings_channels
    ├── assignment_properties (meta: agency_name, ad accounts, budgets)
    └── leads
            ├── leads_inquiries → channels, channel_sources, channel_sub_sources
            ├── leads_events (site visits, meetings)
            ├── lead_details (denormalized attribution + dispositions)
            ├── entity_agent_mappings (owner history)
            ├── bookings → invoice_booking_mappings → brokerage_milestones → brokerage_rules
            │       └── bookings_agent_contribution_allocations
            └── call_centers_dispositions

agent_cp_project_mappings (CP-agent-project tagging)
project_cp_mappings → cp_entity_genie_mappings
agents_teams → agent_team_mappings
logs (audit trail for all entity changes)

profiles (in users DB) ← user_id
channel_partner_events (CP activity events)
```

---

## leads

Primary customer/lead table.

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| name | varchar | Lead name |
| email | varchar | Email address |
| phone | varchar | Phone number |
| agent_id | integer | FK to users DB (assigned sales agent) |
| assignment_id | integer | FK to assignments |
| assignment_supply_entity_mapping_id | integer | FK to asem (project-level) |
| status_id | integer | 1=New, 2=In Progress, 5=Visit Done, 6=Booked, 12=Closed |
| category | varchar | Lead category |
| rating | integer | Lead rating |
| min_budget | integer | Min budget |
| max_budget | integer | Max budget |
| country_id | integer | FK to countries |
| city_id | integer | FK to cities |
| source | varchar | Raw source (prefer leads_inquiries for attribution) |
| apartment_type_ids | integer[] | Preferred apartment types |
| extra_details | jsonb | `->>'cp_id'` for CP leads, `->>'duplicate_lead_id'`, `->>'possession_in'` |
| tags | jsonb | `->>'is_abandoned'` boolean flag |
| status_details | jsonb | Status metadata |
| is_genuine | boolean | Genuine lead flag |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update |

### Common Queries

```sql
-- Lead with full context
SELECT l.id, l.name, l.phone, l.status_id, l.extra_details->>'cp_id' as cp_id,
       se.name as project, a.name as assignment, c.name as city
FROM leads l
JOIN assignment_supply_entity_mappings asem ON asem.id = l.assignment_supply_entity_mapping_id
JOIN supply_entities se ON se.id = asem.supply_entity_id
JOIN assignments a ON a.id = asem.assignment_id
LEFT JOIN cities c ON c.id = se.city_id
WHERE l.id = $1;

-- Leads by assignment with source attribution
SELECT l.id, l.name, l.phone, l.status_id,
       (array_agg(coalesce(li.channel_metadata->>'channel_source', cs.name) ORDER BY li.created_at))[1] source,
       (array_agg(coalesce(li.channel_metadata->>'sub_source', css.name) ORDER BY li.created_at))[1] subsource
FROM leads l
JOIN leads_inquiries li ON li.lead_id = l.id
LEFT JOIN channel_sources cs ON cs.id = li.channel_source_id
LEFT JOIN channel_sub_sources css ON css.id = li.channel_sub_source_id
WHERE l.assignment_id = $1 AND l.created_at > CURRENT_DATE - 7
  AND l.extra_details->>'duplicate_lead_id' IS NULL
  AND NOT coalesce((l.tags->>'is_abandoned')::boolean, false)
GROUP BY l.id, l.name, l.phone, l.status_id;

-- CP leads by partner
SELECT l.id, l.name, l.phone, l.assignment_id
FROM leads l WHERE l.extra_details->>'cp_id' = '$CP_ID' AND l.created_at >= '2024-07-01';

-- Find lead by phone
SELECT id, name, phone, assignment_id, created_at FROM leads WHERE phone ILIKE '%9876543%';
```

---

## supply_entities (Projects)

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| name | varchar(255) | Project name |
| developer_id | integer | FK to developers |
| city_id | integer | FK to cities |
| primary_locality_id | integer | Main locality |
| tagged_locality_ids | integer[] | Additional localities |
| min_price | integer | Minimum price |
| max_price | integer | Maximum price |
| apartment_type_ids | integer[] | Available unit types |
| construction_stage_id | integer | Construction status |
| posession_date | timestamp | Possession (timestamp) |
| possession_date | varchar | Possession (text) |
| rera_ids | varchar[] | RERA registration numbers |
| meta_data | jsonb | Metadata |
| config | jsonb | Configuration |
| inventory_configuration | jsonb | Inventory settings |
| post_sales_configuration | jsonb | Post-sales settings |

### Common Queries

```sql
-- Active projects by city
SELECT id, name, min_price, max_price
FROM supply_entities
WHERE city_id = 1
ORDER BY name;

-- Project with developer
SELECT se.name as project, d.name as developer
FROM supply_entities se
JOIN developers d ON se.developer_id = d.id
WHERE se.id = 123;
```

---

## assignment_supply_entity_mappings (ASEM)

Links mandates to projects.

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| assignment_id | integer | FK to assignments |
| supply_entity_id | integer | FK to supply_entities |
| status_id | integer | 1=Active, 0=Inactive |
| max_lead_per_day | integer | Daily lead cap |
| call_center_campaign_id | varchar | Campaign reference |
| landing_page_url | varchar | Landing page URL |
| meta_data | jsonb | Additional config |

### Common Queries

```sql
-- Active mappings for a mandate
SELECT asem.*, se.name as project_name
FROM assignment_supply_entity_mappings asem
JOIN supply_entities se ON asem.supply_entity_id = se.id
WHERE asem.assignment_id = 123
AND asem.status_id = 1;

-- All mappings for a project
SELECT asem.*, a.name as mandate_name
FROM assignment_supply_entity_mappings asem
JOIN assignments a ON asem.assignment_id = a.id
WHERE asem.supply_entity_id = 456;
```

---

## assignments (Mandates)

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| name | varchar(255) | Mandate name |
| assignment_type_id | integer | Type FK |
| owner_id | integer[] | Owner user IDs (**Postgres array!**) |
| start_date | timestamp | Start date |
| end_date | timestamp | End date |
| status_id | integer | 1=Active, 0=Inactive |
| max_lead_per_day | integer | Daily lead cap |
| target | integer | Total lead target |
| call_cool_period | integer | Hours between calls |
| mask_lead_data | boolean | Data masking enabled |
| send_lead_to_developer | boolean | Webhook enabled |
| developer_callback_url | varchar | Webhook URL |
| legal_entity_id | integer | Legal entity FK |
| profit_centre_id | integer | Profit centre FK |
| ai_time_based_calling | boolean | AI calling enabled |
| fresh_lead_ranker | boolean | Lead ranking enabled |

### Important Notes

- `owner_id` is a **Postgres array** - use `@>` operator for containment
- Use `ANY` for single value match: `WHERE {user_id} = ANY(owner_id)`

### Common Queries

```sql
-- Active mandates
SELECT id, name, start_date, end_date
FROM assignments
WHERE status_id = 1
AND end_date > NOW()
ORDER BY name;

-- Mandates by owner (array contains)
SELECT * FROM assignments
WHERE owner_id @> ARRAY[123::integer];

-- Alternative: ANY operator
SELECT * FROM assignments
WHERE 123 = ANY(owner_id);

-- Mandate with project count
SELECT a.id, a.name, COUNT(asem.id) as project_count
FROM assignments a
LEFT JOIN assignment_supply_entity_mappings asem ON a.id = asem.assignment_id
WHERE a.status_id = 1
GROUP BY a.id, a.name;
```

---

## bookings

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| lead_id | integer | FK to leads |
| asem_id | integer | FK to assignment_supply_entity_mappings |
| brokerage_amount | numeric | Brokerage amount |
| booking_date | date | Date of booking |
| status_id | integer | 1=Active, 3=Cancelled |
| current_request_level_id | integer | Approval level (30=fully approved) |
| current_request_status_id | integer | 2=Approved |
| created_at | timestamp | Creation time |

### Common Queries

```sql
-- Bookings for a lead
SELECT * FROM bookings WHERE lead_id = $1;

-- Brokerage secured by project (approved bookings)
SELECT a.name, sum(b.brokerage_amount) brokerage
FROM bookings b
JOIN leads l ON l.id = b.lead_id
JOIN assignments a ON a.id = l.assignment_id
WHERE b.current_request_level_id = 30 AND b.current_request_status_id = 2
  AND b.booking_date BETWEEN '01-dec-2024' AND '31-dec-2024'
GROUP BY a.name;

-- Bookings by ASEM with project info
SELECT b.id, b.brokerage_amount, se.name project
FROM bookings b
JOIN assignment_supply_entity_mappings asem ON asem.id = b.asem_id
JOIN supply_entities se ON se.id = asem.supply_entity_id
WHERE b.asem_id = $1 ORDER BY b.created_at DESC;
```

---

## collections

Payment collections for bookings (also in leads DB).

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| booking_id | integer | FK to bookings |
| amount | numeric | Collection amount |
| collection_date | timestamp | Date of collection |
| payment_mode_id | integer | Payment mode FK |
| status_id | integer | Collection status |
| created_at | timestamp | Creation time |

### Common Queries

```sql
-- Collections for a booking
SELECT c.*, b.total_amount as booking_amount
FROM collections c
JOIN bookings b ON c.booking_id = b.id
WHERE b.id = 123;

-- Total collections by project
SELECT se.name, SUM(c.amount) as total_collected
FROM collections c
JOIN bookings b ON c.booking_id = b.id
JOIN supply_entities se ON b.supply_entity_id = se.id
WHERE c.status_id = 1
GROUP BY se.name;
```

---

## invoices

Invoice records (in leads DB, not just finance/plutus).

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| booking_id | integer | FK to bookings |
| invoice_number | varchar | Invoice number |
| amount | numeric | Invoice amount |
| status_id | integer | Invoice status |
| generated_at | timestamp | Generation time |

### Common Queries

```sql
-- Invoices for a booking
SELECT * FROM invoices WHERE booking_id = 123;

-- Recent invoices
SELECT i.*, b.total_amount
FROM invoices i
JOIN bookings b ON i.booking_id = b.id
ORDER BY i.generated_at DESC
LIMIT 20;
```

---

## leads_inquiries

Source/channel/subsource for each lead. **Use this for lead attribution, not the `leads.source` column.**

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| lead_id | bigint | FK to leads |
| channel_id | bigint | FK to channels (1=facebook, 2=google) |
| channel_source_id | bigint | FK to channel_sources (1=google, 2=facebook) |
| channel_sub_source_id | bigint | FK to channel_sub_sources |
| asem_id | bigint | FK to assignment_supply_entity_mappings |
| channel_metadata | jsonb | `->>'channel_source'`, `->>'sub_source'`, `->>'channel'`, `->>'channel_group'`, `->>'loggedin_agent_id'` |
| placement | varchar | Ad placement ID |
| inquired_at | timestamp | When inquiry was made |
| created_at | timestamp | Creation time |

### Related Lookup Tables

- `channels` - id=1: facebook, id=2: google
- `channel_sources` - id=1: google, id=2: facebook
- `channel_sub_sources` - searchable by name

### Common Queries

```sql
-- Lead with full attribution
SELECT l.id, l.name, c.name channel, cs.name source, css.name sub_source, li.inquired_at
FROM leads l
JOIN leads_inquiries li ON l.id = li.lead_id
LEFT JOIN channels c ON li.channel_id = c.id
LEFT JOIN channel_sources cs ON li.channel_source_id = cs.id
LEFT JOIN channel_sub_sources css ON li.channel_sub_source_id = css.id
WHERE l.id = $1 ORDER BY li.created_at;

-- First inquiry attribution (DISTINCT ON pattern)
SELECT DISTINCT ON (li.lead_id)
    li.lead_id, li.channel_metadata->>'channel_source' AS source,
    li.channel_metadata->>'sub_source' AS sub_source
FROM leads_inquiries li
WHERE li.lead_id IN (SELECT id FROM leads WHERE assignment_id = $1)
ORDER BY li.lead_id, li.created_at DESC;

-- Facebook leads with UTM params
SELECT l.id, l.name,
       li.channel_metadata->>'sub_source' as sub_source, li.placement
FROM leads l
JOIN leads_inquiries li ON l.id = li.lead_id
WHERE li.channel_source_id = 2  -- facebook
  AND li.channel_metadata->>'sub_source' IN ('ctw_ri', 'leadgen_ri')
ORDER BY li.created_at DESC LIMIT 20;
```

---

## lead_details

Denormalized view of lead attribution and disposition info. One row per lead.

| Column | Type | Description |
|--------|------|-------------|
| lead_id | bigint | FK to leads |
| agents | text | Agent info |
| statuses | integer[] | Status history |
| inquiry_id | integer[] | Inquiry IDs |
| source | text[] | Source names |
| subsource | text[] | Subsource names |
| channel | text[] | Channel names |
| first_inq_channel | text | First inquiry channel |
| first_inq_source | text | First inquiry source |
| first_inq_subsource | text | First inquiry subsource |
| virtual_number | text[] | Virtual numbers used |
| placement | text[] | Ad placements |
| metadata | jsonb | `->>'remarks'`, `->>'call_center_skill_name'`, `->>'call_center_campaign_name'` |
| disposition_name | varchar | CC disposition name |
| updated_at | timestamp | Last update |

```sql
SELECT * FROM lead_details WHERE lead_id = $1;
```

---

## leads_events

Site visits, meetings, and other scheduled events.

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| lead_id | bigint | FK to leads |
| event_type_id | integer | 1=Visit, 2=Meeting |
| status_id | integer | 1=Pending, 2=Failed, 3=Completed |
| asem_id | bigint | FK to asem |
| start_time | timestamp | Scheduled start |
| end_time | timestamp | Actual end |
| metadata | jsonb | `->>'site_registration_flag'`, `->>'acp_flag'` |
| created_at | timestamp | Creation time |

```sql
-- Site visits for a lead
SELECT id, event_type_id, status_id, start_time, end_time
FROM leads_events WHERE lead_id = $1 AND event_type_id = 1;
```

---

## entity_agent_mappings

Tracks which agents owned a lead over time.

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| entity_type | varchar | 'Lead' |
| entity_id | bigint | Lead ID |
| agent_id | integer | FK to users DB |
| created_at | timestamp | Assignment time |

```sql
-- First owner of a lead
SELECT u.name first_owner FROM entity_agent_mappings eam
JOIN users u ON u.id = eam.agent_id  -- NOTE: separate users DB query needed
WHERE eam.entity_type = 'Lead' AND eam.entity_id = $1
ORDER BY eam.created_at LIMIT 1;
```

---

## call_centers_dispositions

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| lead_id | bigint | FK to leads |
| agent_id | integer | CC agent |
| disposition_type_id | integer | Type (3=qualified, 5=connected) |
| metadata | jsonb | `->>'remarks'`, `->>'status_reason_id'`, `->>'reason_ids'`, `->>'type_reason_id'` |
| created_at | timestamp | Disposition time |

---

## logs

Audit trail for entity changes (in leads DB).

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| entity_type | varchar | 'AgentTeamMapping', 'AgentCpProjectMapping', 'CpEntityGenieMapping', etc. |
| entity_id | varchar | Entity primary key |
| employee_id | integer | FK to users DB |
| action_source | varchar | API endpoint or action |
| changes_in_columns | text | Column changes |
| message | text | Log message |
| request_type | varchar | Request category |
| request_id | integer | Request ref |
| created_at | timestamp | Log time |

```sql
-- Audit trail for an entity
SELECT * FROM logs WHERE entity_type = 'AgentCpProjectMapping' AND entity_id = '$ID'
ORDER BY created_at;

-- Recent CP event creations from genie
SELECT * FROM logs
WHERE action_source = 'api/v0/channel_partner_events/create_cp_event_genie'
  AND entity_type = 'ChannelPartnerEvent' AND created_at > '2025-02-01'
ORDER BY id ASC LIMIT 10;
```

---

## agent_cp_project_mappings (acpm)

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| agent_id | integer | FK to users DB (sales agent) |
| project_id | bigint | FK to asem ID |
| channel_partner_id | integer | FK to users DB (CP) |
| status_id | integer | 1=Active, 2=Inactive |
| is_platinum | boolean | Platinum CP flag |
| status_metadata | jsonb | Status details |
| status_updated_at | timestamp | Status change time |
| created_at | timestamp | Creation time |

```sql
-- CP mappings
SELECT * FROM agent_cp_project_mappings
WHERE channel_partner_id = $1 AND project_id = $2;

-- Active count check
SELECT count(id) FROM agent_cp_project_mappings WHERE status_id = 1;

-- Check unique constraint
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'agent_cp_project_mappings';
```

---

## project_cp_mappings (pcm)

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| project_id | integer | ASEM ID |
| channel_partner_id | integer | CP user ID |
| status | integer | 1=Active |

---

## cp_entity_genie_mappings (cegm)

| Column | Type | Description |
|--------|------|-------------|
| id | bigint | Primary key |
| entity_id | bigint | FK to project_cp_mappings.id |
| entity_type | varchar | 'ProjectCpMapping' |
| genie_agent_id | integer | Genie agent ID |
| genie_campaign_id | varchar | Campaign ref |
| genie_channel | varchar | 'WHATSAPP', 'AI_CALLING' |
| intents | text[] | Extracted intents array |
| intent_created_at | timestamp | When intent was extracted |
| is_qualified_mapping | boolean | Qualification flag |
| created_at | timestamp | Creation time |

```sql
-- Genie mappings for a CP on a project
SELECT cegm.* FROM cp_entity_genie_mappings cegm
JOIN project_cp_mappings pcm ON pcm.id = cegm.entity_id AND cegm.entity_type = 'ProjectCpMapping'
WHERE pcm.channel_partner_id = $1 AND pcm.project_id = $2
ORDER BY cegm.updated_at DESC;

-- Mappings with intents
SELECT * FROM cp_entity_genie_mappings
WHERE ARRAY_LENGTH(intents, 1) > 0 AND created_at >= CURRENT_DATE - 1;
```

---

## agents_teams / agent_team_mappings

| Column | Type | Description |
|--------|------|-------------|
| agents_teams.id | bigint | Team PK |
| agents_teams.assignment_supply_entity_mapping_id | bigint | FK to asem |
| agent_team_mappings.team_id | bigint | FK to agents_teams |
| agent_team_mappings.agent_employee_id | integer | FK to users DB |

---

## Brokerage Chain

```sql
-- invoice_booking_mappings → brokerage_milestones → brokerage_rules
SELECT ibm.id, ibm.booking_id, ibm.status_id,
       bm.id milestone_id, bm.status_id milestone_status,
       br.id rule_id, br.status_id rule_status
FROM invoice_booking_mappings ibm
JOIN brokerage_milestones bm ON bm.id = ibm.brokerage_milestone_id
JOIN brokerage_rules br ON br.id = bm.brokerage_rule_id
WHERE ibm.booking_id = $1;
```

---

## Other Frequently Used Tables

| Table | Key Columns | Usage |
|-------|-------------|-------|
| `cities` | `id`, `name` | City lookup |
| `countries` | `id`, `name` | Country lookup |
| `apartment_types` | `id`, `name` | Apartment type names |
| `leads_statuses` | `id`, `name` | Status name lookup |
| `configurables` | `custom_id`, `configurable_type_id` | Dynamic config values |
| `configurables_types` | `id` | Config type definitions |
| `trespect_leads` / `trespect_leads_agents` | Lead assignment tracking | Trespect module |
| `sf_leads` / `sf_leads_new` | `lead_id` | Salesforce sync tracking |
| `channel_partner_events` | `channel_partner_id`, `created_at` | CP activity events |
| `fb_leadgen` (leads DB copy) | `lead_id`, `form_id`, `leadgen_id` | FB leadgen records |
| `fb_form_configs` | `form_id`, `page_id` | Form-to-assignment mapping |
| `google_leadgen` | | Google lead form data |
| `phones` | `id` | Phone number pool |
