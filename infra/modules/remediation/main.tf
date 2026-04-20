variable "alert_email" { type = string }
variable "account_id" { type = string }

# SNS Topic
resource "aws_sns_topic" "providence_alerts" {
  name = "providence-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.providence_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Lambda zip packaging
data "archive_file" "revoke_iam_zip" {
  type        = "zip"
  source_file = "${path.module}/revoke_iam_credentials.py"
  output_path = "${path.module}/revoke_iam_credentials.zip"
}

data "archive_file" "terminate_instance_zip" {
  type        = "zip"
  source_file = "${path.module}/terminate_suspicious_instance.py"
  output_path = "${path.module}/terminate_suspicious_instance.zip"
}

data "archive_file" "sns_alert_zip" {
  type        = "zip"
  source_file = "${path.module}/sns_alert_publisher.py"
  output_path = "${path.module}/sns_alert_publisher.zip"
}

# Lambda: Revoke IAM Credentials
resource "aws_lambda_function" "revoke_iam" {
  function_name = "providence-revoke-iam-credentials"
  runtime       = "python3.12"
  handler       = "revoke_iam_credentials.handler"
  filename      = data.archive_file.revoke_iam_zip.output_path
  source_code_hash = data.archive_file.revoke_iam_zip.output_base64sha256
  role          = aws_iam_role.revoke_iam_role.arn
  timeout       = 30
}

resource "aws_iam_role" "revoke_iam_role" {
  name = "providence-revoke-iam-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = "sts:AssumeRole", Effect = "Allow",
      Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "revoke_iam_policy" {
  name = "revoke-iam-policy"
  role = aws_iam_role.revoke_iam_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["iam:UpdateAccessKey", "iam:ListAccessKeys"], Resource = "*" },
      { Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource = "*" },
    ]
  })
}

# Lambda: Terminate Suspicious Instance
resource "aws_lambda_function" "terminate_instance" {
  function_name = "providence-terminate-suspicious-instance"
  runtime       = "python3.12"
  handler       = "terminate_suspicious_instance.handler"
  filename      = data.archive_file.terminate_instance_zip.output_path
  source_code_hash = data.archive_file.terminate_instance_zip.output_base64sha256
  role          = aws_iam_role.terminate_role.arn
  timeout       = 30
}

resource "aws_iam_role" "terminate_role" {
  name = "providence-terminate-instance-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = "sts:AssumeRole", Effect = "Allow",
      Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "terminate_policy" {
  name = "terminate-instance-policy"
  role = aws_iam_role.terminate_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ec2:StopInstances", "ec2:CreateTags", "ec2:DescribeInstances"], Resource = "*" },
      { Effect = "Allow", Action = ["logs:*"], Resource = "*" },
    ]
  })
}

# Lambda: SNS Alert Publisher
resource "aws_lambda_function" "sns_alert" {
  function_name = "providence-sns-alert-publisher"
  runtime       = "python3.12"
  handler       = "sns_alert_publisher.handler"
  filename      = data.archive_file.sns_alert_zip.output_path
  source_code_hash = data.archive_file.sns_alert_zip.output_base64sha256
  role          = aws_iam_role.sns_alert_role.arn
  timeout       = 10
  environment {
    variables = { ALERT_TOPIC_ARN = aws_sns_topic.providence_alerts.arn }
  }
}

resource "aws_iam_role" "sns_alert_role" {
  name = "providence-sns-alert-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = "sts:AssumeRole", Effect = "Allow",
      Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "sns_alert_policy" {
  name = "sns-alert-policy"
  role = aws_iam_role.sns_alert_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.providence_alerts.arn },
      { Effect = "Allow", Action = ["logs:*"], Resource = "*" },
    ]
  })
}

output "alert_topic_arn" { value = aws_sns_topic.providence_alerts.arn }
