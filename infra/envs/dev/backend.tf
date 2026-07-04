terraform {
  backend "s3" {
    bucket       = "pilo-dev-683655334891-terraform-state"
    key          = "infra/dev/terraform.tfstate"
    region       = "ap-northeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
