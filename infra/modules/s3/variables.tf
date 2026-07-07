variable "name_prefix" {
  type = string
}

variable "uploads_cors_allowed_origins" {
  type    = list(string)
  default = []
}
