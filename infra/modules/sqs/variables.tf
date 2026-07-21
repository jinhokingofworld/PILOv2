variable "name_prefix" {
  type = string
}

variable "visibility_timeout_seconds" {
  type    = number
  default = 300
}

variable "agent_visibility_timeout_seconds" {
  description = "Visibility timeout for Agent planning jobs."
  type        = number
  default     = 180
}
