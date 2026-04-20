# Providence Infrastructure Reference

---

## 🪣 S3 Bucket

| Setting | Value |
|---|---|
| Bucket name | `providence-honeypot-data` |
| Region | us-east-1 |
| Versioning | Enabled |
| Public access | Fully blocked |
| Log structure | `{instance-name}/{year}/{month}/{day}/cowrie-{timestamp}.json` |
| Malware samples | `{instance-name}/downloads/{year}/{month}/{day}/` |

---

## 🍯 Honeypot Fleet (The Lure)

| Instance | Region | Public IP | Persona Hostname | Instance ID | Type |
|---|---|---|---|---|---|
| LURE-SSH-US | us-east-1 (Virginia) | `54.91.174.191` | `prod-web-01` | i-0d27a886f58bfc034 | t3.micro |
| LURE-SSH-EU | eu-west-1 (Ireland) | `3.253.60.6` | `prod-api-eu` | i-07aceb8dcd6bbc5f2 | t3.micro |
| LURE-SSH-AP | ap-southeast-1 (Singapore) | `3.0.102.2` | `prod-db-sg` | i-0df3f5c78670beea4 | t3.micro |

**Per-instance config:**
- Real SSH on port **62222** (restricted to your IP only)
- Cowrie honeypot on port **2222**
- iptables redirects ports **22 and 23 → 2222**
- Log ship cron every **6 hours**
- Survives reboots via **systemd + iptables-persistent**
- Stack: Ubuntu 24.04 LTS, Cowrie 2.9.10, AWS CLI v2

---

## 🔑 SSH & Keys

```bash
# SSH key local path
/Users/graeme/.ssh/providence_honeypot

# Connect to any honeypot (replace IP)
ssh -i /Users/graeme/.ssh/providence_honeypot -p 62222 ubuntu@<IP>

# Quick connect aliases
ssh -i /Users/graeme/.ssh/providence_honeypot -p 62222 ubuntu@54.91.174.191      # US
ssh -i /Users/graeme/.ssh/providence_honeypot -p 62222 ubuntu@3.253.60.6        # EU
ssh -i /Users/graeme/.ssh/providence_honeypot -p 62222 ubuntu@3.0.102.2        # AP
```

---

## ⚙️ AWS IAM Resources

| Resource | Name | Permissions |
|---|---|---|
| IAM User | `providence-deployer` | EC2, S3, VPC, IAM full access |
| IAM Role | `providence-honeypot-role` | CloudWatch + S3 access |
| Instance Profile | `providence-honeypot-profile` | Attached to EC2 instances |
| IAM User | `providence-dashboard` | S3 read-only (for dashboard) |

**Security Groups:**
- `lure-ssh-sg` — `sg-017a2008387e5170d` (us-east-1)
- `lure-ssh-eu-sg` — `sg-0a214e38324be54b6` (eu-west-1)
- `lure-ssh-ap-sg` — `sg-0ab07ac3b6bb9b3ea` (ap-southeast-1)

---

## 🖥️ Key Commands

**Force all three honeypots to ship latest logs:**
```bash
for HOST in 3.85.57.241 108.129.228.110 3.0.102.2; do
  echo "=== Shipping from $HOST ==="
  ssh -i /Users/graeme/.ssh/providence_honeypot -p 62222 ubuntu@$HOST \
    "sudo -u cowrie /home/cowrie/ship-logs.sh" 2>/dev/null
done
```

**Sync all logs to your Mac (excluding malware samples):**
```bash
mkdir -p ~/providence/logs
aws s3 sync s3://providence-honeypot-data/ ~/providence/logs/ --exclude "*/downloads/*"
```

**Check what's in the bucket (size summary):**
```bash
aws s3 ls s3://providence-honeypot-data/ --recursive --human-readable --summarize
```

**Daily midnight PST auto-sync cron (8AM UTC):**
```bash
# Add to your Mac's crontab (crontab -e)
0 8 * * * aws s3 sync s3://providence-honeypot-data/ ~/providence/logs/ --exclude "*/downloads/*"
```

**Run log aggregation stats script:**
```bash
python3 ~/providence/providence_stats.py
```

---

## 📊 Collected Stats (as of April 14, 2026)

- **282,863 sessions** across 3 honeypots (665 log files, deduplicated)
- **183,933 BRUTE_FORCE** sessions (65.0%)
- **92,726 PROBE** sessions (32.8%)
- **6,204 EXFILTRATION** sessions (2.2%)
- 3 regions: us-east-1, eu-west-1, ap-southeast-1
- 79% of SSH clients identify as `SSH-2.0-Go` (automated tools)
- Notable capture: **Trojan.Multiverze** cryptominer ELF binary (`7a9da7d10aa80b0f9e2e3f9e518030c86026a636e0b6de35905e15dd4c8e3e2d`)

**To refresh these numbers:**
```bash
aws s3 sync s3://providence-honeypot-data/ ~/providence/logs/ --exclude "*/downloads/*"
python3 scripts/normalize/cowrie_to_providence.py --input ~/providence/logs/ --output ./data/honeypot/
```
