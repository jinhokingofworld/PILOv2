variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "recordings_bucket_arn" {
  type = string
}

variable "livekit_secret_arns" {
  type    = list(string)
  default = []
}

variable "ami_id" {
  description = "Pinned AMI ID for the LiveKit host. Update only during a planned host rotation."
  type        = string
  sensitive   = true
}

variable "instance_type" {
  type = string
}

variable "root_volume_size" {
  type = number
}

variable "allowed_cidr_blocks" {
  type = list(string)
}
