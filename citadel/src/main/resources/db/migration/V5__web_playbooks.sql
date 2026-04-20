INSERT INTO playbooks (name, category, description, actions, min_confidence, ttl_seconds) VALUES
('Web Phishing Response', 'WEB_PHISHING', 'Critical alert on phishing page detection', '["CRITICAL_ALERT"]', 0.70, 86400),
('Web Cryptominer Response', 'WEB_CRYPTOMINER', 'Alert on cryptominer script detection', '["CRITICAL_ALERT"]', 0.70, 3600),
('Web Injection Response', 'WEB_INJECTION', 'Alert on suspicious script injection', '["CRITICAL_ALERT"]', 0.70, 3600),
('Web Tracking Response', 'WEB_TRACKING', 'Observe excessive tracking/fingerprinting', '["OBSERVE"]', 0.70, 3600);
