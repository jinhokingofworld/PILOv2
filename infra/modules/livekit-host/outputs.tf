output "instance_id" {
  value = aws_instance.this.id
}

output "public_ip" {
  value = aws_eip.this.public_ip
}

output "public_dns" {
  value = aws_eip.this.public_dns
}

output "security_group_id" {
  value = aws_security_group.this.id
}

output "instance_profile_name" {
  value = aws_iam_instance_profile.this.name
}
