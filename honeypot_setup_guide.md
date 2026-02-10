# Providence Honeypot Fleet — Setup & Deployment Guide

```
         ◉
        /|\
       / | \
      /  |  \
         |
    T H E   L U R E
    Honeypot Fleet Setup
```

**Author:** Graeme Huntley
**Date:** February 2026
**Status:** Ready for Deployment

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [AWS Account Setup](#3-aws-account-setup)
4. [LURE-SSH: Your First Honeypot](#4-lure-ssh-your-first-honeypot)
5. [Log Shipping to S3](#5-log-shipping-to-s3)
6. [LURE-WEB: Web Attack Honeypot](#6-lure-web-web-attack-honeypot)
7. [LURE-DB: Database Honeypot](#7-lure-db-database-honeypot)
8. [LURE-IOT: IoT Honeypot (Raspberry Pi)](#8-lure-iot-iot-honeypot-raspberry-pi)
9. [Fleet Monitoring & Maintenance](#9-fleet-monitoring--maintenance)
10. [Data Pipeline: From Logs to Training Data](#10-data-pipeline-from-logs-to-training-data)
11. [Cost Management](#11-cost-management)
12. [Terraform Automation](#12-terraform-automation)
13. [Troubleshooting](#13-troubleshooting)
14. [Security Considerations](#14-security-considerations)

---

## 1. Overview

The Lure is Providence's honeypot fleet — a set of deliberately vulnerable
servers deployed across AWS regions to attract and log real-world attack traffic.
This data feeds the ML training pipeline in Phases 3 and 6.

### Fleet Composition

| Instance | Region | Profile | Open Ports | Primary Data |
|---|---|---|---|---|
| LURE-SSH | us-east-1 | SSH honeypot (cowrie) | 22, 2222 | Brute force attempts, credential lists, post-auth commands |
| LURE-WEB | eu-west-1 | Web honeypot (dionaea + DVWA) | 80, 443, 8080 | SQL injection, XSS, directory traversal, web scanning |
| LURE-DB | ap-southeast-1 | Database honeypot (dionaea) | 3306, 5432, 27017, 1433 | DB credential stuffing, enumeration attempts |
| LURE-IOT | Home network | IoT honeypot (custom) | 23, 80, 5555, 49152 | Mirai-variant scanning, UPnP exploitation |

### Why Multiple Instances?

Different port profiles attract fundamentally different attack types. A machine
with SSH open gets brute force bots. A machine with HTTP open gets web scanners
and injection attempts. A machine with database ports open gets credential
stuffing and enumeration. Running them in different AWS regions means you also
get geographic diversity in your attack sources — attack traffic patterns vary
significantly between US, EU, and Asia-Pacific regions.

### Timeline

- **Week 1:** Deploy LURE-SSH (fastest to set up, highest volume of attacks)
- **Week 2:** Deploy LURE-WEB (second priority, different attack category)
- **Week 3-4:** Deploy LURE-DB. LURE-IOT is optional and runs on local hardware.
- **Ongoing:** Let them run. Check in weekly. Pull data monthly.

---

## 2. Prerequisites

### Tools to Install

```bash
# AWS CLI v2
# macOS:
brew install awscli

# Verify installation
aws --version

# Terraform
brew install terraform
terraform --version

# SSH key (if you don't have one)
ssh-keygen -t ed25519 -C "providence-honeypot"
# Save to: ~/.ssh/providence_honeypot
```

### AWS Account

If you don't have an AWS account yet:

1. Go to https://aws.amazon.com/free/
2. Create account with your personal email (NOT your .edu — keep this separate)
3. Add a payment method (required but free tier covers most costs)
4. **IMMEDIATELY** set up a billing alert:
   - AWS Console → Billing → Budgets → Create Budget
   - Monthly cost budget: $15 (warning) and $30 (critical)
   - Email alerts to your personal email

### Estimated Monthly Costs

| Resource | Free Tier | Post-Free Tier |
|---|---|---|
| EC2 t2.micro (per instance) | 750 hrs/month (shared across all t2.micro) | ~$8.50/month |
| S3 storage (log data) | 5 GB | ~$0.023/GB after |
| Data transfer | 100 GB outbound | ~$0.09/GB after |
| **Total (1 instance)** | **$0-1/month** | **~$10/month** |
| **Total (3 instances)** | **~$17/month** | **~$28/month** |

**Strategy:** Start with 1 instance (LURE-SSH) on free tier. Add instances
as budget allows. You can always stop instances when not actively collecting
and restart them later.

---

## 3. AWS Account Setup

### 3.1 Configure AWS CLI

```bash
# Configure with your credentials
aws configure
# AWS Access Key ID: [from IAM console]
# AWS Secret Access Key: [from IAM console]
# Default region name: us-east-1
# Default output format: json
```

### 3.2 Create IAM User for Providence (Don't Use Root)

NEVER use your root account for this. Create a dedicated IAM user:

```bash
# Create the user
aws iam create-user --user-name providence-deployer

# Create access keys
aws iam create-access-key --user-name providence-deployer
# SAVE THESE KEYS SECURELY. You won't see the secret key again.

# Attach necessary policies
aws iam attach-user-policy \
  --user-name providence-deployer \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2FullAccess

aws iam attach-user-policy \
  --user-name providence-deployer \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

aws iam attach-user-policy \
  --user-name providence-deployer \
  --policy-arn arn:aws:iam::aws:policy/AmazonVPCFullAccess
```

### 3.3 Create S3 Bucket for Honeypot Logs

```bash
# Create the central log bucket
aws s3 mb s3://providence-honeypot-data --region us-east-1

# Enable versioning (protects against accidental deletion)
aws s3api put-bucket-versioning \
  --bucket providence-honeypot-data \
  --versioning-configuration Status=Enabled

# Block all public access (this data is private)
aws s3api put-public-access-block \
  --bucket providence-honeypot-data \
  --public-access-block-configuration \
    BlockPublicAcls=true,\
    IgnorePublicAcls=true,\
    BlockPublicPolicy=true,\
    RestrictPublicBuckets=true
```

### 3.4 Create Key Pair for SSH Access

```bash
# Import your SSH public key to each region you'll deploy in
aws ec2 import-key-pair \
  --key-name providence-key \
  --public-key-material fileb://~/.ssh/providence_honeypot.pub \
  --region us-east-1

aws ec2 import-key-pair \
  --key-name providence-key \
  --public-key-material fileb://~/.ssh/providence_honeypot.pub \
  --region eu-west-1

aws ec2 import-key-pair \
  --key-name providence-key \
  --public-key-material fileb://~/.ssh/providence_honeypot.pub \
  --region ap-southeast-1
```

---

## 4. LURE-SSH: Your First Honeypot

This is the one to deploy first. SSH brute force attacks are the most common
automated attack on the internet. You will start seeing data within hours.

### 4.1 Create Security Group

```bash
# Create security group for SSH honeypot
SG_ID=$(aws ec2 create-security-group \
  --group-name lure-ssh-sg \
  --description "Providence LURE-SSH honeypot" \
  --region us-east-1 \
  --query 'GroupId' \
  --output text)

echo "Security Group ID: $SG_ID"

# Open port 22 (SSH — this is what cowrie will listen on)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 22 \
  --cidr 0.0.0.0/0 \
  --region us-east-1

# Open port 2222 (alternate SSH — some scanners try this)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 2222 \
  --cidr 0.0.0.0/0 \
  --region us-east-1

# Open port 23 (Telnet — attracts Mirai-variant bots)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 23 \
  --cidr 0.0.0.0/0 \
  --region us-east-1

# MANAGEMENT ACCESS: Open a high port for YOUR real SSH access
# Use a non-standard port so it doesn't get mixed with honeypot traffic
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 62222 \
  --cidr $(curl -s ifconfig.me)/32 \
  --region us-east-1

echo "Management SSH on port 62222 restricted to your current IP"
echo "IMPORTANT: Update this if your IP changes"
```

### 4.2 Launch EC2 Instance

```bash
# Find the latest Ubuntu 24.04 AMI in us-east-1
AMI_ID=$(aws ec2 describe-images \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
  --output text \
  --region us-east-1)

echo "Using AMI: $AMI_ID"

# Launch the instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t2.micro \
  --key-name providence-key \
  --security-group-ids $SG_ID \
  --region us-east-1 \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=LURE-SSH},{Key=Project,Value=Providence},{Key=Role,Value=honeypot}]' \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "Instance ID: $INSTANCE_ID"
echo "Waiting for instance to start..."

# Wait for it to be running
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region us-east-1

# Get the public IP
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text \
  --region us-east-1)

echo "LURE-SSH is live at: $PUBLIC_IP"
echo "SSH in with: ssh -i ~/.ssh/providence_honeypot -p 62222 ubuntu@$PUBLIC_IP"
```

### 4.3 Install and Configure Cowrie

SSH into your instance and run the setup:

```bash
# Connect to your honeypot (management port, not the honeypot port)
ssh -i ~/.ssh/providence_honeypot -p 62222 ubuntu@$PUBLIC_IP
```

Once connected, run the following setup script:

```bash
#!/bin/bash
# ============================================
# LURE-SSH Setup Script
# Run this on the EC2 instance after SSH-ing in
# ============================================

echo "=== LURE-SSH Setup Starting ==="

# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y git python3-venv python3-pip \
  libssl-dev libffi-dev build-essential \
  python3-dev authbind jq

# Move real SSH to management port (62222)
# This is CRITICAL — you need to do this BEFORE cowrie takes port 22
sudo sed -i 's/#Port 22/Port 62222/' /etc/ssh/sshd_config
sudo systemctl restart sshd

echo ">>> Real SSH moved to port 62222. Verify you can still connect on 62222"
echo ">>> before proceeding. Open a NEW terminal and test:"
echo ">>>   ssh -i ~/.ssh/providence_honeypot -p 62222 ubuntu@<IP>"
echo ""
echo "Press ENTER when you've confirmed you can connect on 62222..."
read

# Create cowrie user
sudo adduser --disabled-password --gecos "" cowrie

# Install cowrie
sudo su - cowrie << 'COWRIE_SETUP'
git clone https://github.com/cowrie/cowrie.git
cd cowrie

# Create virtual environment
python3 -m venv cowrie-env
source cowrie-env/bin/activate

# Install requirements
pip install --upgrade pip
pip install -r requirements.txt

# Configure cowrie
cp etc/cowrie.cfg.dist etc/cowrie.cfg
COWRIE_SETUP

# Configure cowrie settings
sudo su - cowrie << 'COWRIE_CONFIG'
cd cowrie

# Set hostname to something enticing
cat > etc/cowrie.cfg << 'EOF'
[honeypot]
hostname = prod-web-01
log_path = var/log/cowrie
download_path = var/lib/cowrie/downloads
share_path = share/cowrie
contents_path = honeyfs
txtcmds_path = txtcmds
download_limit_size = 10485760
listen_endpoints = tcp:22:interface=0.0.0.0
                   tcp:2222:interface=0.0.0.0
                   tcp:23:interface=0.0.0.0

[backend_pool]
enabled = false

[output_jsonlog]
enabled = true
logfile = var/log/cowrie/cowrie.json

[output_textlog]
enabled = true
logfile = var/log/cowrie/cowrie.log
EOF
COWRIE_CONFIG

# Allow cowrie to bind to port 22 (low port) without root
# Method: use authbind
sudo touch /etc/authbind/byport/22
sudo touch /etc/authbind/byport/23
sudo touch /etc/authbind/byport/2222
sudo chown cowrie:cowrie /etc/authbind/byport/22
sudo chown cowrie:cowrie /etc/authbind/byport/23
sudo chown cowrie:cowrie /etc/authbind/byport/2222
sudo chmod 770 /etc/authbind/byport/22
sudo chmod 770 /etc/authbind/byport/23
sudo chmod 770 /etc/authbind/byport/2222

# Create systemd service for cowrie
sudo tee /etc/systemd/system/cowrie.service << 'EOF'
[Unit]
Description=Cowrie SSH/Telnet Honeypot
After=network.target

[Service]
User=cowrie
Group=cowrie
WorkingDirectory=/home/cowrie/cowrie
ExecStart=/usr/bin/authbind --deep /home/cowrie/cowrie/cowrie-env/bin/python /home/cowrie/cowrie/src/cowrie/scripts/cowrie.py start --nodaemon
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start cowrie
sudo systemctl daemon-reload
sudo systemctl enable cowrie
sudo systemctl start cowrie

echo ""
echo "=== LURE-SSH Setup Complete ==="
echo ""
echo "Cowrie is running on ports 22, 2222, and 23"
echo "Logs are at: /home/cowrie/cowrie/var/log/cowrie/"
echo "  - cowrie.json (structured logs — THIS IS WHAT WE WANT)"
echo "  - cowrie.log  (human-readable logs)"
echo ""
echo "Verify it's running:"
echo "  sudo systemctl status cowrie"
echo ""
echo "View live attacks:"
echo "  sudo tail -f /home/cowrie/cowrie/var/log/cowrie/cowrie.json | jq ."
```

### 4.4 Verify It's Working

```bash
# Check cowrie is running
sudo systemctl status cowrie

# Watch for attacks in real time (formatted JSON)
sudo tail -f /home/cowrie/cowrie/var/log/cowrie/cowrie.json | jq .

# You should see login attempts within hours. Example output:
# {
#   "eventid": "cowrie.login.failed",
#   "username": "root",
#   "password": "admin123",
#   "src_ip": "185.220.101.34",
#   "timestamp": "2026-02-10T03:14:22.481Z"
# }
```

### 4.5 Quick Verification (Test It Yourself)

From your LOCAL machine (not the honeypot), try connecting:

```bash
# This should connect to cowrie (the fake SSH), not real SSH
ssh root@$PUBLIC_IP

# Try password: admin
# You should get "in" to a fake shell
# Type some commands: ls, cat /etc/passwd, whoami
# Everything you do is logged in cowrie.json

# When done: exit
# Check the logs on the honeypot to see your session recorded
```

---

## 5. Log Shipping to S3

Logs need to get from the honeypot to your central S3 bucket automatically.

### 5.1 Install and Configure AWS CLI on Honeypot

```bash
# On the honeypot instance:
sudo apt install -y awscli

# Create an IAM role for the instance (better than access keys)
# Actually, let's do this the RIGHT way — with an instance profile.
```

### 5.2 Create IAM Role for Honeypot Instances

Run this from your LOCAL machine:

```bash
# Create the trust policy
cat > /tmp/honeypot-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create the role
aws iam create-role \
  --role-name providence-honeypot-role \
  --assume-role-policy-document file:///tmp/honeypot-trust-policy.json

# Create a policy that only allows writing to our bucket
cat > /tmp/honeypot-s3-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::providence-honeypot-data",
        "arn:aws:s3:::providence-honeypot-data/*"
      ]
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name providence-honeypot-role \
  --policy-name honeypot-s3-write \
  --policy-document file:///tmp/honeypot-s3-policy.json

# Create instance profile and attach role
aws iam create-instance-profile \
  --instance-profile-name providence-honeypot-profile

aws iam add-role-to-instance-profile \
  --instance-profile-name providence-honeypot-profile \
  --role-name providence-honeypot-role

# Wait a moment for propagation
sleep 10

# Attach to your running instance
aws ec2 associate-iam-instance-profile \
  --instance-id $INSTANCE_ID \
  --iam-instance-profile Name=providence-honeypot-profile \
  --region us-east-1
```

### 5.3 Set Up Automated Log Shipping

Back on the honeypot instance:

```bash
# Create log shipping script
sudo tee /home/cowrie/ship-logs.sh << 'SHIP'
#!/bin/bash
# ============================================
# Providence Honeypot Log Shipper
# Runs via cron, ships cowrie logs to S3
# ============================================

INSTANCE_NAME="lure-ssh"
BUCKET="providence-honeypot-data"
LOG_DIR="/home/cowrie/cowrie/var/log/cowrie"
DATE=$(date +%Y/%m/%d)
TIMESTAMP=$(date +%H%M%S)

# Ship the JSON log (primary structured data)
if [ -f "$LOG_DIR/cowrie.json" ]; then
  aws s3 cp "$LOG_DIR/cowrie.json" \
    "s3://$BUCKET/$INSTANCE_NAME/$DATE/cowrie-$TIMESTAMP.json" \
    --quiet

  if [ $? -eq 0 ]; then
    echo "[$(date)] Shipped cowrie.json to s3://$BUCKET/$INSTANCE_NAME/$DATE/"

    # Rotate: move shipped log and let cowrie create a fresh one
    mv "$LOG_DIR/cowrie.json" "$LOG_DIR/cowrie.json.shipped.$TIMESTAMP"
    sudo systemctl restart cowrie
  else
    echo "[$(date)] ERROR: Failed to ship logs to S3"
  fi
fi

# Ship any downloaded malware samples
if [ -d "$LOG_DIR/../lib/cowrie/downloads" ]; then
  DOWNLOAD_COUNT=$(find /home/cowrie/cowrie/var/lib/cowrie/downloads -type f | wc -l)
  if [ "$DOWNLOAD_COUNT" -gt 0 ]; then
    aws s3 sync /home/cowrie/cowrie/var/lib/cowrie/downloads/ \
      "s3://$BUCKET/$INSTANCE_NAME/downloads/$DATE/" \
      --quiet
    echo "[$(date)] Shipped $DOWNLOAD_COUNT malware samples"
  fi
fi

# Clean up shipped logs older than 7 days (they're in S3 now)
find "$LOG_DIR" -name "*.shipped.*" -mtime +7 -delete
SHIP

sudo chmod +x /home/cowrie/ship-logs.sh
sudo chown cowrie:cowrie /home/cowrie/ship-logs.sh

# Set up cron to run every 6 hours
sudo -u cowrie crontab << 'CRON'
# Ship honeypot logs to S3 every 6 hours
0 */6 * * * /home/cowrie/ship-logs.sh >> /home/cowrie/ship-logs.log 2>&1
CRON

echo "Log shipping configured. Runs every 6 hours."
echo "Manual run: sudo -u cowrie /home/cowrie/ship-logs.sh"
```

### 5.4 Verify Log Shipping

```bash
# Manual test run
sudo -u cowrie /home/cowrie/ship-logs.sh

# Check S3 from your local machine
aws s3 ls s3://providence-honeypot-data/lure-ssh/ --recursive
```

---

## 6. LURE-WEB: Web Attack Honeypot

Deploy this in Week 2. Different region, different attack surface.

### 6.1 Launch in EU Region

```bash
# Create security group in eu-west-1
WEB_SG_ID=$(aws ec2 create-security-group \
  --group-name lure-web-sg \
  --description "Providence LURE-WEB honeypot" \
  --region eu-west-1 \
  --query 'GroupId' \
  --output text)

# Open web ports
for PORT in 80 443 8080 8443; do
  aws ec2 authorize-security-group-ingress \
    --group-id $WEB_SG_ID \
    --protocol tcp \
    --port $PORT \
    --cidr 0.0.0.0/0 \
    --region eu-west-1
done

# Management SSH
aws ec2 authorize-security-group-ingress \
  --group-id $WEB_SG_ID \
  --protocol tcp \
  --port 62222 \
  --cidr $(curl -s ifconfig.me)/32 \
  --region eu-west-1

# Find Ubuntu AMI in eu-west-1
WEB_AMI=$(aws ec2 describe-images \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
  --output text \
  --region eu-west-1)

# Launch
WEB_INSTANCE=$(aws ec2 run-instances \
  --image-id $WEB_AMI \
  --instance-type t2.micro \
  --key-name providence-key \
  --security-group-ids $WEB_SG_ID \
  --iam-instance-profile Name=providence-honeypot-profile \
  --region eu-west-1 \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=LURE-WEB},{Key=Project,Value=Providence},{Key=Role,Value=honeypot}]' \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "LURE-WEB Instance: $WEB_INSTANCE"
```

### 6.2 Install Dionaea (Web Honeypot)

```bash
# SSH into LURE-WEB on management port
# Then run:

sudo apt update && sudo apt upgrade -y

# Move real SSH to management port
sudo sed -i 's/#Port 22/Port 62222/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Install dionaea
sudo apt install -y dionaea

# Configure dionaea for web attacks
sudo tee /etc/dionaea/dionaea.cfg << 'EOF'
[dionaea]
download.dir=/var/lib/dionaea/binaries/
modules=curl,python,nfq,emu,pcap
processors=filter_streamdumper,filter_sessions

listen.mode=getifaddrs
listen.addresses=0.0.0.0

ssl.default.c=US
ssl.default.cn=prod-api.example.com
ssl.default.o=Example Corp

[module.python]
imports=dionaea.log,dionaea.services.http,dionaea.services.https

[logging]
handlers=log_json
default_handler=log_json

[handler.log_json]
filename=/var/log/dionaea/dionaea.json
EOF

# Enable and start
sudo systemctl enable dionaea
sudo systemctl start dionaea

# Set up the same log shipping cron as LURE-SSH
# (adjust INSTANCE_NAME to "lure-web" and LOG_DIR to "/var/log/dionaea")
```

Additionally, install DVWA (Damn Vulnerable Web Application) for attracting
more sophisticated web attacks:

```bash
# Install DVWA alongside dionaea on a different port
sudo apt install -y apache2 php php-mysql mariadb-server php-gd

# Download DVWA
cd /var/www/html
sudo git clone https://github.com/digininja/DVWA.git
sudo chown -R www-data:www-data DVWA

# Configure Apache to serve on port 8080
sudo tee /etc/apache2/ports.conf << 'EOF'
Listen 8080
EOF

sudo tee /etc/apache2/sites-available/dvwa.conf << 'EOF'
<VirtualHost *:8080>
    DocumentRoot /var/www/html/DVWA
    <Directory /var/www/html/DVWA>
        AllowOverride All
        Require all granted
    </Directory>
    
    # Log EVERYTHING - this is our training data
    CustomLog /var/log/apache2/dvwa-access.json "%{%Y-%m-%dT%H:%M:%S}t %h %m %U %q %s %b \"%{User-Agent}i\" \"%{Referer}i\""
    ErrorLog /var/log/apache2/dvwa-error.log
</VirtualHost>
EOF

sudo a2ensite dvwa.conf
sudo a2dissite 000-default.conf
sudo systemctl restart apache2
```

---

## 7. LURE-DB: Database Honeypot

Deploy in Week 3. Targets database-specific attacks.

### 7.1 Launch in Asia-Pacific Region

```bash
# Same pattern as above, but in ap-southeast-1
DB_SG_ID=$(aws ec2 create-security-group \
  --group-name lure-db-sg \
  --description "Providence LURE-DB honeypot" \
  --region ap-southeast-1 \
  --query 'GroupId' \
  --output text)

# Open database ports
for PORT in 3306 5432 27017 1433 6379; do
  aws ec2 authorize-security-group-ingress \
    --group-id $DB_SG_ID \
    --protocol tcp \
    --port $PORT \
    --cidr 0.0.0.0/0 \
    --region ap-southeast-1
done

# Management SSH
aws ec2 authorize-security-group-ingress \
  --group-id $DB_SG_ID \
  --protocol tcp \
  --port 62222 \
  --cidr $(curl -s ifconfig.me)/32 \
  --region ap-southeast-1

# Launch instance (same process as above, ap-southeast-1 AMI)
```

### 7.2 Configure Database Honeypots

Dionaea can emulate MySQL, MSSQL, and other database services out of the box.
Configure it to log all connection attempts, authentication failures, and any
queries attackers try to run.

```bash
# Dionaea handles MySQL (3306) and MSSQL (1433) natively
# For PostgreSQL (5432) and MongoDB (27017), use additional tools:

# PostgreSQL honeypot
pip install postgresql-honeypot  # or use sticky_elephant

# MongoDB honeypot
pip install mongopot  # or use HoneyMongo

# Redis honeypot (port 6379)
# redis-honeypot captures commands sent to an exposed Redis instance
pip install redis-honeypot
```

---

## 8. LURE-IOT: IoT Honeypot (Raspberry Pi)

This one runs on your home network. Optional but provides a fourth data source
with a very different attack profile.

### 8.1 Requirements

- Raspberry Pi 3B+ or newer
- MicroSD card (16GB+)
- Ethernet connection to your home router
- Port forwarding configured on your router for ports 23, 80, 5555

### 8.2 Setup

```bash
# On the Raspberry Pi (Raspberry Pi OS):
sudo apt update && sudo apt upgrade -y

# Install Cowrie (for Telnet on port 23)
# Follow same cowrie setup as LURE-SSH but configured for Telnet

# Install HoneyTrap for UPnP and other IoT protocols
git clone https://github.com/honeytrap/honeytrap.git
cd honeytrap
# Follow build instructions in their README

# Configure your router to forward:
#   External port 23 → Pi internal IP, port 23
#   External port 80 → Pi internal IP, port 80
#   External port 5555 → Pi internal IP, port 5555 (Android Debug Bridge)
```

### 8.3 Important Note

Running a honeypot on your home network means attack traffic is flowing through
your residential connection. This is generally safe (cowrie/honeytrap don't
actually let attackers in), but:

- Your ISP may flag unusual inbound traffic. Most don't care, but be aware.
- Use a separate VLAN or network segment if your router supports it.
- NEVER expose your real services on the same ports.

---

## 9. Fleet Monitoring & Maintenance

### 9.1 Weekly Health Check Script

Run this from your local machine:

```bash
#!/bin/bash
# ============================================
# Providence Fleet Health Check
# Run weekly to verify honeypots are alive
# ============================================

echo "=== Providence Fleet Health Check ==="
echo "Date: $(date)"
echo ""

# Define fleet
declare -A FLEET
FLEET[LURE-SSH]="us-east-1"
FLEET[LURE-WEB]="eu-west-1"
FLEET[LURE-DB]="ap-southeast-1"

for NAME in "${!FLEET[@]}"; do
  REGION=${FLEET[$NAME]}

  # Get instance status
  STATUS=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=running" \
    --query 'Reservations[0].Instances[0].State.Name' \
    --output text \
    --region $REGION 2>/dev/null)

  IP=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$NAME" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text \
    --region $REGION 2>/dev/null)

  # Check S3 for recent logs
  LATEST_LOG=$(aws s3 ls "s3://providence-honeypot-data/$(echo $NAME | tr '[:upper:]' '[:lower:]')/" \
    --recursive \
    | tail -1)

  echo "[$NAME] Region: $REGION | Status: $STATUS | IP: $IP"
  echo "        Latest log: $LATEST_LOG"
  echo ""
done

# S3 bucket size
BUCKET_SIZE=$(aws s3 ls s3://providence-honeypot-data --recursive --summarize \
  | grep "Total Size" | awk '{print $3, $4}')
echo "Total data collected: $BUCKET_SIZE"
echo ""

# Cost check (current month)
echo "Current month estimated cost:"
aws ce get-cost-and-usage \
  --time-period Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --query 'ResultsByTime[0].Total.BlendedCost.Amount' \
  --output text 2>/dev/null || echo "  (Cost Explorer may need 24h to populate)"

echo ""
echo "=== Health Check Complete ==="
```

### 9.2 Monthly Data Pull

```bash
#!/bin/bash
# Pull all honeypot data locally for analysis
# Run monthly or before ML training phases

MONTH=$(date +%Y/%m)
LOCAL_DIR="$HOME/providence-data/$MONTH"
mkdir -p "$LOCAL_DIR"

echo "Pulling honeypot data for $MONTH..."

aws s3 sync "s3://providence-honeypot-data/" "$LOCAL_DIR/" \
  --exclude "*" \
  --include "*/$MONTH/*"

echo "Data saved to: $LOCAL_DIR"
echo "Files:"
find "$LOCAL_DIR" -type f | wc -l
echo "Total size:"
du -sh "$LOCAL_DIR"
```

---

## 10. Data Pipeline: From Logs to Training Data

This section bridges The Lure to The Eye's ML pipeline. Raw honeypot logs
need to be normalized into Providence's unified event schema.

### 10.1 Unified Event Schema

```json
{
  "timestamp": "2026-02-10T03:14:22.481Z",
  "source": "lure-ssh",
  "src_ip": "185.220.101.34",
  "src_port": 48231,
  "dst_port": 22,
  "protocol": "tcp",
  "session_id": "a1b2c3d4",
  "event_type": "auth_attempt",
  "category": "BRUTE_FORCE",
  "subcategory": "SSH",
  "details": {
    "username": "root",
    "password": "admin123",
    "success": false
  },
  "session_metadata": {
    "duration_seconds": 2.3,
    "attempts_in_session": 15,
    "commands_executed": [],
    "inter_attempt_ms": [142, 156, 148, 151, 143]
  }
}
```

### 10.2 Normalization Scripts

Each honeypot tool produces different log formats. Normalization scripts
convert them all into the schema above:

```
providence/scripts/normalize/
├── normalize_cowrie.py       # Cowrie JSON → unified schema
├── normalize_dionaea.py      # Dionaea logs → unified schema
├── normalize_dvwa.py         # Apache access logs → unified schema
└── normalize_all.py          # Run all normalizers, deduplicate, output Parquet
```

### 10.3 Feature Engineering for ML

From normalized events, extract the features that match The Eye's
classification pipeline:

- **Per-session features:** Total attempts, unique usernames tried,
  unique passwords tried, session duration, success/failure ratio
- **Temporal features:** Inter-attempt timing (mean, std, min, max),
  time-of-day, day-of-week
- **Behavioral features:** Command sequences post-auth, download attempts,
  lateral movement indicators
- **Source features:** IP reputation (can enrich later), geographic origin,
  ASN

These features become labeled training data for the ML models in Phase 3.

---

## 11. Cost Management

### 11.1 AWS Budget Alert Setup

```bash
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget '{
    "BudgetName": "Providence-Monthly",
    "BudgetLimit": {"Amount": "30", "Unit": "USD"},
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST"
  }' \
  --notifications-with-subscribers '[
    {
      "Notification": {
        "NotificationType": "ACTUAL",
        "ComparisonOperator": "GREATER_THAN",
        "Threshold": 50,
        "ThresholdType": "PERCENTAGE"
      },
      "Subscribers": [
        {"SubscriptionType": "EMAIL", "Address": "your-email@example.com"}
      ]
    },
    {
      "Notification": {
        "NotificationType": "ACTUAL",
        "ComparisonOperator": "GREATER_THAN",
        "Threshold": 80,
        "ThresholdType": "PERCENTAGE"
      },
      "Subscribers": [
        {"SubscriptionType": "EMAIL", "Address": "your-email@example.com"}
      ]
    }
  ]'
```

### 11.2 Cost-Saving Strategies

- **Stop instances when not needed.** If you're not actively collecting and
  don't need more data, stop the instances. You only pay for running instances.
  Your data in S3 is pennies.
- **Use spot instances** for LURE-DB and LURE-IOT-cloud (if you make a cloud
  version). Spot instances are 60-90% cheaper. If AWS reclaims them, you just
  restart — no data is lost since logs ship to S3.
- **Reserved instance** for LURE-SSH if you plan to run it for 6+ months.
  A 1-year no-upfront reserved t2.micro saves ~30%.
- **Delete old log files** from the instance after confirming they're in S3.
  EBS storage costs money too.

### 11.3 Emergency Cost Stop

If something goes wrong or costs spike unexpectedly:

```bash
# STOP ALL HONEYPOTS IMMEDIATELY
for REGION in us-east-1 eu-west-1 ap-southeast-1; do
  INSTANCES=$(aws ec2 describe-instances \
    --filters "Name=tag:Project,Values=Providence" "Name=tag:Role,Values=honeypot" \
    --query 'Reservations[].Instances[].InstanceId' \
    --output text \
    --region $REGION)

  if [ -n "$INSTANCES" ]; then
    echo "Stopping instances in $REGION: $INSTANCES"
    aws ec2 stop-instances --instance-ids $INSTANCES --region $REGION
  fi
done

echo "All Providence honeypots stopped."
```

---

## 12. Terraform Automation

Once you've manually deployed LURE-SSH and understand the process, codify
everything in Terraform. This goes in `providence/infra/modules/honeypot/`.

### 12.1 Module Structure

```
infra/modules/honeypot/
├── main.tf           # EC2 instance, security group, IAM
├── variables.tf      # Configurable parameters
├── outputs.tf        # Instance ID, public IP, log path
├── userdata.sh       # Cloud-init script (auto-installs honeypot software)
└── README.md         # Module documentation
```

### 12.2 Example Usage

```hcl
# infra/environments/honeypots/main.tf

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "providence-terraform-state"
    key    = "honeypots/terraform.tfstate"
    region = "us-east-1"
  }
}

# SSH Honeypot — US East
module "lure_ssh" {
  source = "../../modules/honeypot"

  name          = "LURE-SSH"
  region        = "us-east-1"
  instance_type = "t2.micro"
  profile       = "ssh"
  open_ports    = [22, 2222, 23]
  log_bucket    = "providence-honeypot-data"
  key_name      = "providence-key"
  admin_ip      = var.admin_ip
}

# Web Honeypot — EU West
module "lure_web" {
  source = "../../modules/honeypot"

  name          = "LURE-WEB"
  region        = "eu-west-1"
  instance_type = "t2.micro"
  profile       = "web"
  open_ports    = [80, 443, 8080, 8443]
  log_bucket    = "providence-honeypot-data"
  key_name      = "providence-key"
  admin_ip      = var.admin_ip
}

# Database Honeypot — Asia Pacific
module "lure_db" {
  source = "../../modules/honeypot"

  name          = "LURE-DB"
  region        = "ap-southeast-1"
  instance_type = "t2.micro"
  profile       = "database"
  open_ports    = [3306, 5432, 27017, 1433, 6379]
  log_bucket    = "providence-honeypot-data"
  key_name      = "providence-key"
  admin_ip      = var.admin_ip
}

variable "admin_ip" {
  description = "Your public IP for management SSH access"
  type        = string
}

# Deploy: terraform apply -var="admin_ip=$(curl -s ifconfig.me)"
```

### 12.3 When to Terraform

**Manual first (Weeks 1-2):** Deploy LURE-SSH by hand using the commands in
Section 4. This teaches you what every resource does and why.

**Terraform after (Week 3+):** Once you understand the components, codify
them. Terraform the remaining honeypots and use Terraform for any future
changes. Import your existing LURE-SSH instance into Terraform state.

This is the right learning sequence. Never Terraform something you haven't
done manually at least once.

---

## 13. Troubleshooting

### Common Issues

**"I can't SSH into the honeypot on port 62222"**
- Your IP changed. Update the security group:
  ```bash
  aws ec2 authorize-security-group-ingress \
    --group-id $SG_ID --protocol tcp --port 62222 \
    --cidr $(curl -s ifconfig.me)/32 --region us-east-1
  ```
- Remove old IP rule:
  ```bash
  aws ec2 revoke-security-group-ingress \
    --group-id $SG_ID --protocol tcp --port 62222 \
    --cidr OLD_IP/32 --region us-east-1
  ```

**"Cowrie isn't starting / port 22 is in use"**
- Make sure real SSH was moved to 62222 FIRST
- Check: `sudo ss -tlnp | grep :22`
- If sshd is still on 22: `sudo systemctl restart sshd` after config change

**"No attacks are showing up"**
- Wait. Automated scanners take hours to find new IPs. 24 hours is normal.
- Verify ports are open from outside: `nmap -p 22,2222 $PUBLIC_IP` (from your machine)
- Check cowrie is actually listening: `sudo ss -tlnp | grep cowrie`

**"Log shipping to S3 is failing"**
- Verify IAM instance profile is attached: `curl http://169.254.169.254/latest/meta-data/iam/info`
- Verify bucket exists: `aws s3 ls s3://providence-honeypot-data/`
- Check the ship-logs.log: `cat /home/cowrie/ship-logs.log`

**"My AWS bill is higher than expected"**
- Run the emergency stop script in Section 11.3
- Check for resources you forgot about: `aws ec2 describe-instances --region us-east-1`
- Check for unattached EBS volumes: `aws ec2 describe-volumes --filters Name=status,Values=available`

---

## 14. Security Considerations

You are running intentionally vulnerable servers on the public internet.
Here are the things that could actually go wrong and how to prevent them.

### 14.1 Separation of Concerns

- **NEVER run real services on a honeypot instance.** No personal files,
  no real databases, no credentials beyond what's needed for management.
- **NEVER reuse the honeypot SSH key** for anything else. The `providence_honeypot`
  key is for honeypot management only.
- **NEVER store AWS root credentials** on a honeypot instance. The IAM
  instance profile has write-only S3 access and nothing else.

### 14.2 Management Access

- Real SSH runs on port 62222, restricted to your IP only
- Update the security group rule when your IP changes
- Consider using AWS Systems Manager Session Manager instead of SSH
  for management access (no open ports needed)

### 14.3 What If Something Goes Wrong

- **Cowrie gets exploited:** Extremely unlikely (it's well-maintained and
  sandboxed), but if it happens, the instance is disposable. Terminate it
  and deploy a fresh one. Your data is in S3.
- **Attacker gains real SSH access:** Only possible if they guess your
  management port AND your SSH key is compromised. Use ed25519 keys
  (which you are) and keep the private key local.
- **AWS account compromise:** The honeypot IAM role can ONLY write to one
  S3 bucket. Even if an attacker gets instance credentials, the blast
  radius is limited to that bucket.

### 14.4 Legal Compliance

- Honeypots are legal in the US, EU, and most jurisdictions.
  You are running a service and logging who connects to it.
- You are NOT intercepting third-party communications.
- You are NOT accessing other people's systems.
- See ETHICS.md in the main Providence documentation for the full
  ethical framework.

---

## Appendix: Quick Reference Commands

```bash
# === Instance Management ===
# Start a stopped instance
aws ec2 start-instances --instance-ids $INSTANCE_ID --region us-east-1

# Stop an instance (saves money, keeps data)
aws ec2 stop-instances --instance-ids $INSTANCE_ID --region us-east-1

# Terminate an instance (destroys it permanently)
aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region us-east-1

# === Check Fleet Status ===
# List all Providence instances across regions
for REGION in us-east-1 eu-west-1 ap-southeast-1; do
  echo "=== $REGION ==="
  aws ec2 describe-instances \
    --filters "Name=tag:Project,Values=Providence" \
    --query 'Reservations[].Instances[].[Tags[?Key==`Name`].Value|[0],InstanceId,State.Name,PublicIpAddress]' \
    --output table \
    --region $REGION
done

# === View Collected Data ===
# Total data size
aws s3 ls s3://providence-honeypot-data/ --recursive --summarize | tail -2

# Latest files per honeypot
aws s3 ls s3://providence-honeypot-data/lure-ssh/ --recursive | tail -5
aws s3 ls s3://providence-honeypot-data/lure-web/ --recursive | tail -5
aws s3 ls s3://providence-honeypot-data/lure-db/ --recursive | tail -5

# Download a specific log file for inspection
aws s3 cp s3://providence-honeypot-data/lure-ssh/2026/02/10/cowrie-031422.json ./
cat cowrie-031422.json | jq . | head -50

# === Quick Deploy New Honeypot ===
# Once Terraform is set up:
cd providence/infra/environments/honeypots
terraform apply -var="admin_ip=$(curl -s ifconfig.me)"
```

---

*The Lure is patient. Deploy it and let it fish.*
