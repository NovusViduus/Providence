INSERT INTO playbooks (name, category, description, actions, min_confidence, ttl_seconds) VALUES
('IAM Escalation Response', 'IAM_ESCALATION', 'Block source IP and critical alert on IAM privilege escalation', '["BLOCK", "CRITICAL_ALERT"]', 0.85, 86400),
('Resource Abuse Response', 'RESOURCE_ABUSE', 'Critical alert on unauthorized resource creation', '["CRITICAL_ALERT"]', 0.85, 86400),
('Data Exposure Response', 'DATA_EXPOSURE', 'Block source IP and critical alert on data exposure', '["BLOCK", "CRITICAL_ALERT"]', 0.85, 86400);
