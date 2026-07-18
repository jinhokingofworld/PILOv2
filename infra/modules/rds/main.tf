resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db-subnet-group"
  subnet_ids = var.subnet_ids
}

resource "aws_db_instance" "this" {
  identifier = "${var.name_prefix}-postgres"

  engine                      = "postgres"
  engine_version              = "17.9"
  allow_major_version_upgrade = true
  instance_class              = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 2
  storage_encrypted     = true

  db_name  = var.database_name
  username = var.master_username

  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = var.security_group_ids
  publicly_accessible    = false
  multi_az               = false
  deletion_protection    = var.deletion_protection
  skip_final_snapshot    = true

  backup_retention_period = 1
  apply_immediately       = true
}
