-- Fix BENIGN events that were incorrectly assigned ACT or RECOMMEND tier
UPDATE security_events
SET response_tier = 'OBSERVE'
WHERE category = 'BENIGN' AND response_tier != 'OBSERVE';
