variable "name_prefix" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "assign_public_ip" {
  type = bool
}

variable "execution_role_arn" {
  type = string
}

variable "log_retention_in_days" {
  type    = number
  default = 7
}

variable "services" {
  type = map(object({
    image              = string
    cpu                = number
    memory             = number
    desired_count      = number
    container_port     = optional(number)
    security_group_ids = list(string)
    task_role_arn      = string
    target_group_arn   = optional(string)
    command            = optional(list(string))
    environment        = map(string)
    secrets            = map(string)
  }))
}
