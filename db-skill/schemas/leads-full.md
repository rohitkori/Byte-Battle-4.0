# Leads Full Schema

All tables in the `leads` alias, organized by domain.

> Core tables with column details are in `leads-core.md`. This file lists all tables by category.

## Discovering Tables

```sql
SELECT DISTINCT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '$TABLE' ORDER BY ordinal_position;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '$TABLE';
```

## Core Business

| Table | Description |
|-------|-------------|
| `leads` | Primary lead/customer table |
| `leads_inquiries` | Source/channel attribution per lead |
| `lead_details` | Denormalized lead attribution + disposition view |
| `leads_events` | Site visits, meetings (event_type_id: 1=Visit, 2=Meeting) |
| `leads_statuses` | Status name lookup |
| `leads_notes` | `source_id`, `source_type='Lead'` |
| `leads_status_reasons` | Status change reasons |

## Assignments & Projects

| Table | Description |
|-------|-------------|
| `assignments` | Mandates/campaigns |
| `assignment_supply_entity_mappings` (asem) | Links assignments to projects |
| `assignment_supply_entity_mappings_channels` | Channel configs per ASEM (`channel_id`, `campaign_id`) |
| `assignment_properties` | Rich meta config (ad accounts, budgets, commission blocks) |
| `supply_entities` | Projects/inventory |
| `cities` | City lookup |
| `countries` | Country lookup |
| `developers` | Developer companies |
| `localities` | Locality lookup |

## Bookings & Finance

| Table | Description |
|-------|-------------|
| `bookings` | Booking records (brokerage_amount, booking_date, status_id) |
| `bookings_agent_contribution_allocations` | Agent contribution splits |
| `collections` | Payment collections (`entity_id`, `entity_type='Invoice'`) |
| `invoices` | Invoice records (`assignment_id`, `amount`, `status`, `revenue_date`) |
| `invoice_booking_mappings` | Links invoices to bookings via brokerage milestones |
| `brokerage_milestones` | Brokerage milestone definitions |
| `brokerage_rules` | Brokerage rule configurations |
| `brokerage_rules_metric_breakdowns` | Metric breakdowns |
| `claims` / `claim_logs` | Brokerage claims and audit |
| `profit_centres` | Profit centre definitions |
| `inventories_quotations` | Inventory quotation data |

## CP & Agent Management

| Table | Description |
|-------|-------------|
| `agent_cp_project_mappings` (acpm) | CP-agent-project tagging (status_id: 1=Active, 2=Inactive) |
| `project_cp_mappings` (pcm) | Project-CP mappings |
| `cp_entity_genie_mappings` (cegm) | Genie AI interaction tracking per CP-project |
| `agents_teams` | Team definitions (linked to ASEM) |
| `agent_team_mappings` | Agent-to-team assignments |
| `entity_agent_mappings` | Owner history (entity_type='Lead') |
| `channel_partner_events` | CP activity events |
| `developer_cp_mappings` | Developer-CP relationship + rating |

## Call Center

| Table | Description |
|-------|-------------|
| `call_centers_dispositions` | CC disposition records |
| `call_centers_dispositions_types` | Disposition type definitions |
| `call_centers_dispositions_types_reasons` | Disposition type reasons |

## Channels & Attribution

| Table | Description |
|-------|-------------|
| `channels` | Channel names (1=facebook, 2=google) |
| `channel_sources` | Source names (1=google, 2=facebook) |
| `channel_sub_sources` | Subsource names |
| `apartment_types` | Apartment type lookup |

## Facebook/Google Lead Integration

| Table | Description |
|-------|-------------|
| `fb_leadgen` | Facebook leadgen records (lead_id, form_id, page_id, status) |
| `fb_form_configs` | Form-to-assignment mapping |
| `fb_forms` | Facebook form definitions |
| `fb_pages` | Facebook page lookup |
| `google_leadgen` | Google lead form data |
| `adwords_clicks` | Google click tracking ("Google Click ID", lead_id) |

## Configuration & System

| Table | Description |
|-------|-------------|
| `configurables` | Dynamic config values (custom_id, configurable_type_id) |
| `configurables_types` | Config type definitions |
| `sql_queries` | Saved queries (status='active') |
| `alerts_log` | System alerts |

## Audit & Logging

| Table | Description |
|-------|-------------|
| `logs` | Audit trail (entity_type, entity_id, employee_id, action_source) |
| `permissions` | Role-based access (in users DB) |

## Trespect Module

| Table | Description |
|-------|-------------|
| `trespect_leads` | Trespect lead records (received_at, agent_id) |
| `trespect_leads_agents` | Lead-agent assignment tracking (start_time, end_time) |

## Salesforce Sync

| Table | Description |
|-------|-------------|
| `sf_leads` | Salesforce lead sync |
| `sf_leads_new` | New SF lead sync format |
