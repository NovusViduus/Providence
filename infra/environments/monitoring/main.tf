variable "vpc_id" { type = string }
variable "account_id" { type = string }
variable "alert_email" { type = string }

module "monitoring" {
  source     = "../../modules/monitoring"
  vpc_id     = var.vpc_id
  account_id = var.account_id
}

module "remediation" {
  source      = "../../modules/remediation"
  account_id  = var.account_id
  alert_email = var.alert_email
}

output "flow_log_bucket" { value = module.monitoring.flow_log_bucket }
output "cloudtrail_bucket" { value = module.monitoring.cloudtrail_bucket }
output "alert_topic_arn" { value = module.remediation.alert_topic_arn }
