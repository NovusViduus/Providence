-- Fix INET columns to VARCHAR for compatibility with JPA/Hibernate
-- INET type causes cast issues when Hibernate reads/writes plain strings

ALTER TABLE security_events ALTER COLUMN source_ip TYPE VARCHAR(45) USING source_ip::text;
ALTER TABLE security_events ALTER COLUMN dest_ip TYPE VARCHAR(45) USING dest_ip::text;

ALTER TABLE incident_reports ALTER COLUMN source_ip TYPE VARCHAR(45) USING source_ip::text;

ALTER TABLE response_actions ALTER COLUMN source_ip TYPE VARCHAR(45) USING source_ip::text;
