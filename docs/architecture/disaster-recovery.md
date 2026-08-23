# Disaster Recovery & RPO/RTO Evidence

## Overview
This document outlines the disaster recovery architecture and guarantees for the ERP system. Our primary data persistence layer is PostgreSQL (managed by Supabase), and object storage is managed via Supabase Storage (backed by S3-compatible infrastructure).

## Recovery Objectives
- **Recovery Point Objective (RPO):** < 1 minute (Point-in-Time Recovery).
- **Recovery Time Objective (RTO):** < 15 minutes for failover to a replica.

## Mechanisms

### 1. Database Persistence
- **Point-in-Time Recovery (PITR):** The PostgreSQL database uses WAL (Write-Ahead Log) archiving combined with continuous daily snapshots. This allows us to rollback the database state to any exact second within the retention window (typically 7 to 30 days depending on the tier).
- **Replication:** Multi-AZ deployments ensure that a hot replica is always available. In the event of primary instance failure, traffic is immediately routed to the replica.

### 2. File & Blob Storage
- **S3 Versioning:** Our Storage buckets have versioning enabled. When a document is updated or deleted, the previous version is retained. This prevents accidental data loss from rogue mutations and allows straightforward rollback.
- **Backups:** Object storage is redundantly backed up across regions.

### 3. Application State
- The UI and Node backend are fully stateless. 
- Infrastructure is defined via Terraform/Supabase Migrations, allowing a complete redeployment of the application layer from scratch in under 5 minutes.

## Testing 
- **DB Reset Verification:** The `scripts/verify-fresh-db.mjs` test runs in CI to guarantee that migration 0 to HEAD can boot successfully on a fresh cluster.
- **Incident Response:** Any data corruption requires immediately consulting the Supabase PITR dashboard to establish a recovery timeline.
