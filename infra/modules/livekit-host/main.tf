data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "recordings_bucket" {
  statement {
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
    ]
    resources = [var.recordings_bucket_arn]
  }

  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:PutObject",
    ]
    resources = ["${var.recordings_bucket_arn}/*"]
  }
}

data "aws_iam_policy_document" "livekit_secrets" {
  count = length(var.livekit_secret_arns) > 0 ? 1 : 0

  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.livekit_secret_arns
  }
}

resource "aws_security_group" "this" {
  name        = "${var.name_prefix}-livekit-sg"
  description = "Self-hosted LiveKit EC2 security group"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP for ACME challenge"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  ingress {
    description = "HTTPS LiveKit API and WebSocket"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  ingress {
    description = "LiveKit WebRTC TCP fallback"
    from_port   = 7881
    to_port     = 7881
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  ingress {
    description = "LiveKit embedded TURN/STUN"
    from_port   = 3478
    to_port     = 3478
    protocol    = "udp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  ingress {
    description = "LiveKit WebRTC UDP media"
    from_port   = 50000
    to_port     = 60000
    protocol    = "udp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    description = "Outbound for package install, S3, ACME, and media negotiation"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "this" {
  name               = "${var.name_prefix}-livekit-host-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "recordings_bucket" {
  name   = "${var.name_prefix}-livekit-recordings-bucket"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.recordings_bucket.json
}

resource "aws_iam_role_policy" "livekit_secrets" {
  count = length(var.livekit_secret_arns) > 0 ? 1 : 0

  name   = "${var.name_prefix}-livekit-secrets"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.livekit_secrets[0].json
}

resource "aws_iam_instance_profile" "this" {
  name = "${var.name_prefix}-livekit-host-profile"
  role = aws_iam_role.this.name
}

resource "aws_instance" "this" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.this.id]
  iam_instance_profile        = aws_iam_instance_profile.this.name
  associate_public_ip_address = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    encrypted   = true
    volume_size = var.root_volume_size
    volume_type = "gp3"
  }

  user_data = <<-EOF
    #!/bin/bash
    set -euxo pipefail

    dnf update -y
    dnf install -y docker docker-compose-plugin
    systemctl enable --now docker
    usermod -aG docker ec2-user

    mkdir -p /opt/pilo/livekit
    chown -R ec2-user:ec2-user /opt/pilo

    cat >/opt/pilo/livekit/README.next <<'README'
    Copy the generated infra/livekit host files here before starting LiveKit:

      .env
      Caddyfile
      docker-compose.yml
      egress.yaml
      livekit.yaml
      redis.conf

    Then run:

      docker compose --env-file .env up -d
    README
  EOF

  tags = {
    Name = "${var.name_prefix}-livekit"
  }
}

resource "aws_eip" "this" {
  domain   = "vpc"
  instance = aws_instance.this.id

  tags = {
    Name = "${var.name_prefix}-livekit-eip"
  }
}
