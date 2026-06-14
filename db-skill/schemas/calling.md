# Calling Schema

Complete schema for telephony and call management tables.

> **Note:** This file needs to be populated with full table documentation.

## Database

Alias: `calling`

## Discovering Tables

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

## Expected Tables

### Call Records
- call_logs
- call_records
- call_transcripts
- call_recordings

### Phone Management
- phone_mappings
- virtual_numbers
- phone_assignments
- number_pool

### Telephony Configuration
- telephony_configs
- ivr_configs
- call_routing_rules
- extension_mappings

### Analytics
- call_analytics
- agent_performance
- call_quality_metrics

> **TODO:** Populate with full table documentation.
