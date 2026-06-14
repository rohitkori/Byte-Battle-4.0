# Users Schema

Alias: `users`

## Table Relationships

```
companies
    └── users
            ├── profiles (profile_type: 'Employee', 'Channel Partner', 'Call Center Agent')
            │       ├── permissions (role-based access to entities)
            │       └── reporting_manager_id → profiles.id
            └── channel_partner_firms
cities ← users.city_id
sub_tenants ← users.sub_tenant_id
```

---

## users

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `name` | varchar | Full name |
| `email` | varchar | Email address |
| `phone` | varchar | Phone number |
| `company_id` | integer | FK to companies |
| `city_id` | integer | FK to cities |
| `sub_tenant_id` | integer | FK to sub_tenants |
| `channel_partner_firm_id` | integer | FK to channel_partner_firms (for CPs) |
| `status_id` | integer | 1=Active |
| `profile_type` | varchar | User type |
| `joining_date` | date | Date of joining |
| `birthday` | date | Birthday |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update |

### Common Queries

```sql
-- Find user by email/phone
SELECT id, name, email, phone FROM users WHERE email = 'user@anarock.com';
SELECT id, name, email, phone FROM users WHERE phone = '9876543210';

-- Find user by ID (from leads DB agent_id/channel_partner_id)
SELECT id, name, email, phone FROM users WHERE id = $1;

-- Active employees
SELECT u.name, u.email, p.profile_details->>'designation' as designation,
       p.profile_details->>'department' as department, c.name as city
FROM users u
JOIN profiles p ON p.user_id = u.id AND p.profile_type = 'Employee' AND p.status_id = 1
JOIN cities c ON c.id = u.city_id
WHERE u.status_id = 1
  AND u.email ILIKE ANY(ARRAY['%@anarock.com%', '%@trespect.com%']);
```

---

## profiles

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `user_id` | integer | FK to users |
| `profile_type` | varchar | 'Employee', 'Channel Partner', 'Call Center Agent' |
| `status_id` | integer | 1=Active, 2=Inactive, 3=User Deactivated |
| `reporting_manager_id` | integer | FK to profiles.id (manager's profile) |
| `profile_details` | jsonb | `->>'designation'`, `->>'department'`, `->>'sub_department'`, `->>'role'`, `->>'employee_code'`, `->'localities'` |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update |

### Common Queries

```sql
-- CP count
SELECT count(user_id) FROM profiles WHERE profile_type = 'Channel Partner';

-- CP localities search
SELECT users.name, users.phone, (profiles.profile_details->'localities')::text as localities
FROM profiles
JOIN users ON users.id = profiles.user_id
WHERE profiles.profile_type = 'Channel Partner'
  AND profiles.profile_details->'localities' IS NOT NULL
  AND (profiles.profile_details->'localities')::text ILIKE '%thane%';

-- Manager chain
SELECT u.name employee, rm.name manager, rm.email manager_email
FROM users u
JOIN profiles p ON p.user_id = u.id
JOIN profiles pm ON pm.id = p.reporting_manager_id
JOIN users rm ON rm.id = pm.user_id
WHERE u.id = $1;
```

---

## permissions

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `profile_id` | integer | FK to profiles |
| `role_id` | integer | FK to roles |
| `entity_type` | varchar | 'Assignment', 'AssignmentSupplyEntityMapping' |
| `entity_id` | integer | ID of the entity |
| `created_at` | timestamp | Creation time |

```sql
-- Who has access to an assignment
SELECT u.email FROM users u
JOIN profiles p ON p.user_id = u.id
WHERE p.id IN (
  SELECT profile_id FROM permissions
  WHERE role_id IN (1, 2) AND entity_type = 'Assignment' AND entity_id = $1
);
```

---

## Other Tables

| Table | Key Columns | Usage |
|-------|-------------|-------|
| `roles` | `id`, `name` | Role definitions |
| `companies` | `id`, `name` | Company entities |
| `cities` | `id`, `name` | City lookup |
| `sub_tenants` | `id`, `name` | Sub-tenant orgs |
| `channel_partner_firms` | `id`, `name`, `rera_id`, `rera_ids` | CP firm details |
| `logs` | `entity_type`, `entity_id`, `employee_id`, `action_source`, `changes_in_columns`, `created_at` | Audit trail |
