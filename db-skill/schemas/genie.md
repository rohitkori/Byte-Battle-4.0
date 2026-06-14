# Genie Schema

Alias: `genie`

> **Note:** Genie has its own `users` table (not the same as users DB). Genie users have `anarock_id` which maps to the users DB `users.id`.

## Table Relationships

```
users (genie-local, has anarock_id)
    ├── sessions (chat sessions)
    │       └── messages
    ├── cp_leads (CP-submitted leads)
    ├── calls (outbound calls)
    ├── ai_calls (AI calling)
    │       └── qualified_projects
    └── drip_marketing → campaigns

campaigns (WhatsApp/AI Call campaigns)
    ├── drip_marketing (message delivery records)
    └── ai_calls (AI call records)

agents (bot agents, has assignments[])
calling_agents (AI calling agent configs)

cp_meets (CP meet events)
    └── cp_meet_registrations
```

---

## campaigns

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `broadcast_name` | varchar | Campaign name (null for API-triggered) |
| `campaign_method` | varchar | 'API', 'AI_CALL_API', etc. |
| `target_audience` | varchar | 'CP' for channel partners |
| `agent_id` | integer | FK to agents (bot) |
| `project_id` | integer | Project reference |
| `template_name` | varchar | WhatsApp template name |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update |

```sql
SELECT id, broadcast_name, campaign_method, target_audience, agent_id, project_id
FROM campaigns WHERE id = '$UUID';

-- Recent API campaigns for CP
SELECT * FROM campaigns
WHERE target_audience = 'CP' AND campaign_method = 'API'
ORDER BY created_at DESC LIMIT 10;

-- Campaign method counts
SELECT campaign_method, target_audience,
  COUNT(*) FILTER (WHERE project_id IS NULL) AS without_project,
  COUNT(*) FILTER (WHERE project_id IS NOT NULL) AS with_project
FROM campaigns WHERE target_audience = 'CP'
GROUP BY 1, 2;
```

---

## users (genie-local)

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `anarock_id` | varchar | **Maps to users DB users.id** |
| `user_type` | varchar | 'CP' for channel partners |
| `phone_number` | varchar | Phone number |
| `hashed_password` | varchar | Password hash |

```sql
SELECT * FROM users WHERE anarock_id = '11314';
SELECT * FROM users WHERE phone_number = '7098655223';
```

---

## agents

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `assignments` | integer[] | Array of assignment IDs |
| `user_types` | text[] | User types this agent handles |
| `updated_at` | timestamp | Last update |

```sql
-- All assignments for an agent
SELECT id, assignments FROM agents WHERE id = $1;

-- Agents handling CPs
SELECT id, assignments FROM agents WHERE ARRAY['CP'] && user_types::text[];

-- All unique assignments across CP agents
SELECT ARRAY_AGG(DISTINCT unnest_val) FROM (
  SELECT unnest(assignments) AS unnest_val FROM agents WHERE ARRAY['CP'] && user_types::text[]
) sub;
```

---

## sessions

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK to users |
| `agent_id` | integer | FK to agents |
| `session_type` | varchar | 'DEFAULT', etc. |
| `created_at` | timestamp | Creation time |

```sql
-- Sessions for a CP (join with users to get anarock_id)
SELECT users.anarock_id AS cp_id, sessions.id AS session_id, sessions.created_at
FROM sessions
JOIN users ON users.id = sessions.user_id
WHERE sessions.agent_id = $1;

-- Session IDs for a CP
SELECT users.anarock_id AS cp_id, ARRAY_AGG(sessions.id) AS session_ids
FROM sessions
JOIN users ON sessions.user_id = users.id
WHERE users.user_type = 'CP' AND sessions.session_type = 'DEFAULT'
  AND users.anarock_id IN ('11314')
GROUP BY cp_id;
```

---

## ai_calls

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `user_id` | uuid | FK to users |
| `campaign_id` | uuid | FK to campaigns |
| `calling_agent_id` | integer | FK to calling_agents |
| `call_intent_extracted` | varchar | 'RSVP_POSITIVE', etc. |
| `recording` | varchar | Recording URL |
| `created_at` | timestamp | Creation time |

```sql
-- AI calls with intent for a calling agent
SELECT campaign_id, call_intent_extracted, ai_calls.*
FROM ai_calls
JOIN users ON users.id = ai_calls.user_id
WHERE users.user_type = 'CP' AND ai_calls.calling_agent_id = $1
  AND call_intent_extracted IS NOT NULL
ORDER BY ai_calls.created_at DESC LIMIT 100;

-- Find campaign for a specific CP + calling agent
SELECT campaigns.*
FROM campaigns
JOIN ai_calls ON campaigns.id = ai_calls.campaign_id
JOIN users ON ai_calls.user_id = users.id AND users.user_type = 'CP'
WHERE users.anarock_id = '$CP_ANAROCK_ID'
  AND ai_calls.calling_agent_id = $AGENT_ID
  AND campaigns.campaign_method = 'AI_CALL_API'
ORDER BY ai_calls.created_at DESC LIMIT 1;
```

---

## drip_marketing

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `user_id` | uuid | FK to users |
| `campaign_id` | uuid | FK to campaigns |
| `message_id` | uuid | FK to messages |
| `created_at` | timestamp | Creation time |

```sql
SELECT * FROM drip_marketing WHERE campaign_id = '$UUID' ORDER BY created_at DESC;
SELECT * FROM drip_marketing WHERE user_id = '$USER_UUID' ORDER BY created_at DESC LIMIT 5;
```

---

## calls

Outbound calls made through genie.

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `user_id` | uuid | FK to users |
| `project_id` | integer | Project reference |
| `agent_id` | integer | Genie agent ID |
| `created_at` | timestamp | Creation time |

```sql
-- CP calls with project info
SELECT calls.id, users.anarock_id AS cp_id, calls.project_id, calls.agent_id,
       EXTRACT(EPOCH FROM calls.created_at)::INTEGER AS created_at_epoch
FROM calls
JOIN users ON users.id = calls.user_id
WHERE users.user_type = 'CP' AND calls.project_id IS NOT NULL
ORDER BY calls.created_at ASC;
```

---

## cp_leads

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `anarock_id` | integer | Maps to leads DB lead ID |
| `user_id` | uuid | FK to users (the CP who submitted) |
| `agent_id` | integer | Genie agent ID |
| `project_id` | integer | Project reference |
| `created_at` | timestamp | Creation time |

```sql
SELECT cp_leads.anarock_id AS lead_id, users.anarock_id AS cp_id,
       cp_leads.agent_id, cp_leads.project_id
FROM cp_leads
JOIN users ON cp_leads.user_id = users.id
ORDER BY cp_leads.created_at LIMIT 10;
```

---

## cp_meets / cp_meet_registrations

| Column | Type | Notes |
|--------|------|-------|
| `cp_meets.id` | integer | PK |
| `cp_meets.name` | varchar | Event name (e.g. 'EventCPOverview') |
| `cp_meets.calling_agent_id` | integer | FK to calling_agents |
| `cp_meets.project_id` | integer | Project ref |
| `cp_meets.event_date` | date | Event date |
| `cp_meet_registrations.cp_id` | integer | CP anarock_id |
| `cp_meet_registrations.meet_id` | integer | FK to cp_meets |
| `cp_meet_registrations.pax` | integer | Number of attendees |
| `cp_meet_registrations.channels` | text[] | Registration channels |

```sql
-- Registrations for a CP
SELECT updated_at + interval '5:30', *
FROM cp_meet_registrations WHERE cp_id = $1 ORDER BY updated_at DESC;

-- Find duplicate registrations
SELECT cp_id, meet_id, array_agg(id)
FROM cp_meet_registrations GROUP BY 1, 2 HAVING count(id) > 1;
```

---

## Other Tables

| Table | Key Columns | Usage |
|-------|-------------|-------|
| `calling_agents` | `id`, `is_deleted` | AI calling agent configs |
| `qualified_projects` | `message_id`, `call_id` | Projects qualified via AI calls |
| `messages` | `id`, `created_at` | Chat messages |
| `meta_data` | `id` | Metadata store |
| `meta_messages` | `created_at` | Facebook/IG message logs |
