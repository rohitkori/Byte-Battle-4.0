---
name: db
description: Use when the user wants to query Anarock PostgreSQL databases through the local db CLI - e.g. "query leads", "show bookings", "find user", "check assignments", "look up campaign rows". Routes natural language to the correct SQL database alias and query pattern.
---

# Anarock PostgreSQL Query Skill

Use the local `db` CLI for all database lookups. It is already configured for the correct environment; do not add environment flags or ask the user to choose an environment.

## Quick Routing

| User says... | CLI Command | Alias |
|--------------|-------------|-------|
| lead, leads, customer, booking | `db query leads "..."` | `leads` |
| project, supply, entity, mandate | `db query leads "..."` | `leads` |
| user, employee, agent, CP | `db query users "..."` | `users` |
| ad, campaign, facebook, leadgen | `db query digix "..."` | `digix` |
| invoice, collection in leads tables | `db query leads "..."` | `leads` |
| marketing, spend, analytics | `db query analytics "..."` | `analytics` |
| genie, AI, message, drip | `db query genie "..."` | `genie` |
| call, telephony, phone | `db query calling "..."` | `calling` |
| finance, plutus | `db query finance "..."` | `finance` |

## CLI Usage

```bash
db query leads "SELECT id, name, phone FROM leads WHERE id = 12345"
db query users "SELECT id, name FROM users LIMIT 10"
db query genie "SELECT id, broadcast_name FROM campaigns LIMIT 10"
```

Use aliases instead of full database names. The CLI resolves aliases internally:

| Alias | Use For |
|-------|---------|
| `leads` | Leads, assignments, projects, bookings, invoices in leads tables |
| `users` | Employees, agents, channel partners, profiles |
| `digix` | Digital marketing, ad integrations, leadgen |
| `finance` | Plutus finance tables, rarely needed |
| `genie` | AI messaging, drip campaigns, sessions, calls |
| `calling` | Telephony and call logs |
| `analytics` | Reporting, aggregate marketing/spend data |

## Core Rules

- Never join across database aliases. Query each alias separately and correlate IDs in the answer.
- The `users` table only exists in the `users` alias. Other aliases do not have a shared users table.
- Genie has its own `users` table for Genie users; it is not the `users` alias.
- Always add `LIMIT` to exploratory queries.
- Return timestamps in IST when useful: `created_at + interval '5:30'`.
- Use `ILIKE` for case-insensitive text search.
- Use `information_schema.columns` to discover columns when unsure.
- Use `pg_indexes` to check indexes when query shape matters.

## Cross-Database Boundaries

```
leads.agent_id                         -> users.id
agent_cp_project_mappings.agent_id     -> users.id
agent_cp_project_mappings.channel_partner_id -> users.id
profiles.user_id                       -> users.id
assignments.owner_id[]                 -> users.id
```

Always fetch user details with a separate `db query users ...` query.

## Common User ID Columns

| Column | Meaning | Lookup |
|--------|---------|--------|
| `agent_id` | Sales agent assigned to lead/record | `db query users "SELECT id, name FROM users WHERE id = <agent_id>"` |
| `channel_partner_id` | Channel Partner | `db query users "SELECT id, name FROM users WHERE id = <cp_id>"` |
| `owner_id` | Assignment owner array | `db query users "SELECT id, name FROM users WHERE id = ANY(ARRAY[...])"` |
| `created_by`, `updated_by` | User who created/modified record | Same pattern |

## Frequently Used Relationships

### Within `leads`

```
assignments
  -> assignment_supply_entity_mappings
    -> supply_entities -> cities, developers
    -> leads
      -> leads_inquiries -> channels, channel_sources, channel_sub_sources
      -> leads_events
      -> bookings -> invoice_booking_mappings -> brokerage_milestones
      -> entity_agent_mappings

agent_cp_project_mappings
  -> project_cp_mappings -> cp_entity_genie_mappings
  -> agents_teams -> agent_team_mappings
```

### Within `genie`

```
users
  -> sessions -> messages
  -> drip_marketing -> campaigns
  -> ai_calls -> campaigns

campaigns
  -> drip_marketing
  -> ai_calls
  -> calling_agents
```

### Genie to Leads Links

| Genie Table | Column | Leads Reference |
|-------------|--------|-----------------|
| `campaigns.project_id` | integer | `assignment_supply_entity_mappings.id` |
| `agents.assignments[]` | integer[] | `assignment_supply_entity_mappings.assignment_id` |

## Query Patterns

### Lead With Context

```bash
db query leads "SELECT l.id, l.name, l.phone, l.status_id, l.extra_details->>'cp_id' AS cp_id,
       se.name AS project, a.name AS assignment, c.name AS city
FROM leads l
JOIN assignment_supply_entity_mappings asem ON asem.id = l.assignment_supply_entity_mapping_id
JOIN supply_entities se ON se.id = asem.supply_entity_id
JOIN assignments a ON a.id = asem.assignment_id
LEFT JOIN cities c ON c.id = se.city_id
WHERE l.id = 12345"
```

### Lead Attribution

Use `leads_inquiries` for source/channel attribution, not `leads.source`.

```bash
db query leads "SELECT l.id, l.name, c.name AS channel, cs.name AS source, css.name AS sub_source
FROM leads l
JOIN leads_inquiries li ON l.id = li.lead_id
LEFT JOIN channels c ON li.channel_id = c.id
LEFT JOIN channel_sources cs ON li.channel_source_id = cs.id
LEFT JOIN channel_sub_sources css ON li.channel_sub_source_id = css.id
WHERE l.id = 12345"
```

### Assignment to Projects

```bash
db query leads "SELECT asem.id AS asem_id, se.name AS project_name, a.name AS assignment_name
FROM assignment_supply_entity_mappings asem
JOIN supply_entities se ON se.id = asem.supply_entity_id
JOIN assignments a ON a.id = asem.assignment_id
WHERE asem.assignment_id = 123"
```

### CP and Agent Details

```bash
db query leads "SELECT id, agent_id, project_id, channel_partner_id, status_id
FROM agent_cp_project_mappings
WHERE id = 1648496"

db query users "SELECT id, name, email, phone FROM users WHERE id IN (215657, 139333)"
```

### CP Project Mappings

```bash
db query leads "SELECT acpm.id, acpm.project_id, acpm.agent_id, acpm.status_id, se.name AS project
FROM agent_cp_project_mappings acpm
JOIN assignment_supply_entity_mappings asem ON asem.id = acpm.project_id
JOIN supply_entities se ON se.id = asem.supply_entity_id
WHERE acpm.channel_partner_id = 139333 AND acpm.status_id = 1"
```

### Genie Campaign Investigation

```bash
db query genie "SELECT id, broadcast_name, campaign_method, target_audience, agent_id, project_id, template_name
FROM campaigns
WHERE id = 'CAMPAIGN_UUID'"

db query genie "SELECT id, user_id, message_id, created_at
FROM drip_marketing
WHERE campaign_id = 'CAMPAIGN_UUID'
ORDER BY created_at DESC LIMIT 10"

db query genie "SELECT id, user_id, call_intent_extracted, recording, created_at
FROM ai_calls
WHERE campaign_id = 'CAMPAIGN_UUID'
ORDER BY created_at DESC LIMIT 10"
```

### Digix Leadgen

```bash
db query digix "SELECT id, leadgen_id, lead_id, form_id, page_id, status, created_at
FROM fb_leadgen
WHERE lead_id = 12345
ORDER BY created_at DESC LIMIT 10"
```

### Marketing Spend

```bash
db query analytics "SELECT source, subsource, SUM(spends) AS total_spend
FROM spends_sheet
WHERE assignment_id = 123
GROUP BY source, subsource
ORDER BY total_spend DESC
LIMIT 20"
```

### Brokerage Chain

```bash
db query leads "SELECT b.id, b.lead_id, b.brokerage_amount, b.booking_date,
       ibm.brokerage_milestone_id, bm.brokerage_rule_id
FROM bookings b
LEFT JOIN invoice_booking_mappings ibm ON ibm.booking_id = b.id
LEFT JOIN brokerage_milestones bm ON bm.id = ibm.brokerage_milestone_id
WHERE b.lead_id = 12345"
```

## Useful Discovery Queries

```bash
db query leads "SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'leads'
ORDER BY ordinal_position"

db query leads "SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'leads'"
```

## Detailed Schemas

Read only the relevant schema file when needed:

- `schemas/leads-core.md` - Core leads tables
- `schemas/leads-full.md` - Complete leads table list
- `schemas/users.md` - Users, employees, profiles
- `schemas/digix.md` - Digital marketing and leadgen
- `schemas/finance.md` - Finance and invoicing
- `schemas/genie.md` - AI messaging and campaigns
- `schemas/calling.md` - Telephony and call logs
- `schemas/analytics.md` - Reporting and marketing analytics

## Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Joining across database aliases | `relation does not exist` | Query each alias separately |
| Wrong alias | `table does not exist` | Check Quick Routing |
| Using `leads.source` | Inconsistent attribution | Use `leads_inquiries` |
| Joining Genie `users` with the `users` alias | Confusing results | Treat Genie `users` as local to Genie |
| Querying `users` table in `leads` | `relation does not exist` | Query `users` alias separately |
| Missing IST conversion | Timestamps show UTC | Add `+ interval '5:30'` |
