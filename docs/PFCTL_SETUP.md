# pfctl Setup for Providence (macOS)

Providence's PfctlFirewallManager uses pfctl tables to block/rate-limit IPs. This requires a pf anchor configuration.

## Setup

### 1. Create the Providence anchor file

```bash
sudo tee /etc/pf.anchors/providence << 'EOF'
table <providence_blocklist> persist
table <providence_ratelimit> persist
block drop in quick on en0 from <providence_blocklist> to any
pass in on en0 from <providence_ratelimit> to any \
    flags S/SA keep state \
    (max-src-conn 10, max-src-conn-rate 5/30, overload <providence_blocklist>)
EOF
```

### 2. Add the anchor to /etc/pf.conf

Add these lines before the final rules:

```
anchor "providence"
load anchor "providence" from "/etc/pf.anchors/providence"
```

### 3. Reload pf

```bash
sudo pfctl -f /etc/pf.conf
sudo pfctl -e  # enable pf if not already enabled
```

### 4. Verify

```bash
sudo pfctl -t providence_blocklist -T show  # should be empty
sudo pfctl -t providence_ratelimit -T show  # should be empty
```

### 5. Configure Providence

In `citadel/src/main/resources/application.yml`:

```yaml
providence:
  firewall:
    platform: pfctl
```

## Notes

- Replace `en0` with your network interface if different
- Providence needs root/sudo access to run pfctl commands
- All blocks are TTL-based and auto-expire via BlockExpiryService
