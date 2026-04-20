variable "vpc_id" { type = string }
variable "account_id" { type = string }

# VPC Flow Logs → S3
resource "aws_s3_bucket" "flow_logs" {
  bucket = "providence-flow-logs-${var.account_id}"
}

resource "aws_flow_log" "providence" {
  vpc_id                   = var.vpc_id
  traffic_type             = "ALL"
  log_destination          = aws_s3_bucket.flow_logs.arn
  log_destination_type     = "s3"
  max_aggregation_interval = 600
}

# CloudTrail → S3
resource "aws_s3_bucket" "cloudtrail" {
  bucket = "providence-cloudtrail-${var.account_id}"
}

resource "aws_s3_bucket_policy" "cloudtrail_policy" {
  bucket = aws_s3_bucket.cloudtrail.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid = "AWSCloudTrailAclCheck", Effect = "Allow",
      Principal = { Service = "cloudtrail.amazonaws.com" },
      Action = "s3:GetBucketAcl", Resource = aws_s3_bucket.cloudtrail.arn
    }, {
      Sid = "AWSCloudTrailWrite", Effect = "Allow",
      Principal = { Service = "cloudtrail.amazonaws.com" },
      Action = "s3:PutObject", Resource = "${aws_s3_bucket.cloudtrail.arn}/*",
      Condition = { StringEquals = { "s3:x-amz-acl" = "bucket-owner-full-control" } }
    }]
  })
}

resource "aws_cloudtrail" "providence" {
  name                          = "providence-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  depends_on                    = [aws_s3_bucket_policy.cloudtrail_policy]
}

# IAM Role for The Oracle
resource "aws_iam_role" "oracle" {
  name = "providence-oracle-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = "sts:AssumeRole", Effect = "Allow",
      Principal = { Service = "ec2.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "oracle_policy" {
  name = "oracle-policy"
  role = aws_iam_role.oracle.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject", "s3:ListBucket"],
        Resource = [aws_s3_bucket.flow_logs.arn, "${aws_s3_bucket.flow_logs.arn}/*",
                    aws_s3_bucket.cloudtrail.arn, "${aws_s3_bucket.cloudtrail.arn}/*"] },
      { Effect = "Allow", Action = ["ec2:DescribeNetworkAcls", "ec2:CreateNetworkAclEntry", "ec2:DeleteNetworkAclEntry"],
        Resource = "*" },
      { Effect = "Allow", Action = ["sns:Publish"], Resource = "*" },
    ]
  })
}

output "flow_log_bucket" { value = aws_s3_bucket.flow_logs.id }
output "cloudtrail_bucket" { value = aws_s3_bucket.cloudtrail.id }
output "oracle_role_arn" { value = aws_iam_role.oracle.arn }

# Providence NACL for CloudFirewallManager
resource "aws_network_acl" "providence" {
  vpc_id = var.vpc_id
  tags   = { Name = "providence-blocklist-nacl" }
}

# Default allow-all rule (Providence adds DENY rules dynamically)
resource "aws_network_acl_rule" "allow_all_ingress" {
  network_acl_id = aws_network_acl.providence.id
  rule_number    = 32766
  protocol       = "-1"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  egress         = false
}

resource "aws_network_acl_rule" "allow_all_egress" {
  network_acl_id = aws_network_acl.providence.id
  rule_number    = 32766
  protocol       = "-1"
  rule_action    = "allow"
  cidr_block     = "0.0.0.0/0"
  egress         = true
}

output "nacl_id" { value = aws_network_acl.providence.id }
