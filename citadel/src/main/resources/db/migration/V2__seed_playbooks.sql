INSERT INTO playbooks (name, category, description, actions, min_confidence, ttl_seconds) VALUES
('DOS Response', 'DOS', 'Rate limit source IP on DoS detection', '["RATE_LIMIT"]', 0.85, 3600),
('Brute Force Response', 'BRUTE_FORCE', 'Block source IP on brute force detection', '["BLOCK"]', 0.85, 1800),
('Exfiltration Response', 'EXFILTRATION', 'Block source IP and critical alert on exfiltration', '["BLOCK", "CRITICAL_ALERT"]', 0.85, 86400),
('Probe Response', 'PROBE', 'Observe only on port scan / probe detection', '["OBSERVE"]', 0.85, 3600),
('Injection Response', 'INJECTION', 'Block source IP on injection detection', '["BLOCK"]', 0.85, 3600),
('AI Agent Response', 'AI_AGENT', 'Block source IP and critical alert on AI agent detection', '["BLOCK", "CRITICAL_ALERT"]', 0.85, 86400);
