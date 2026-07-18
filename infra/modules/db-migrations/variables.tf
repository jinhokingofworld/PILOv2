variable "name_prefix" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "image" {
  type = string
}

variable "execution_role_arn" {
  type = string
}

variable "database_host" {
  type = string
}

variable "database_port" {
  type = number
}

variable "database_name" {
  type = string
}

variable "database_secret_arn" {
  type = string
}

variable "log_retention_in_days" {
  type    = number
  default = 7
}
