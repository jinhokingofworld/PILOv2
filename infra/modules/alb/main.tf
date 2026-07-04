locals {
  enable_https = var.create_https_listener && var.api_certificate_arn != ""
}

resource "aws_lb" "this" {
  name               = "${var.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids
}

resource "aws_lb_target_group" "app" {
  name        = "${var.name_prefix}-app-tg"
  port        = var.app_server_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = "/api/v1/health"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "realtime" {
  name        = "${var.name_prefix}-realtime-tg"
  port        = var.realtime_server_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = "/health"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "PILO dev ALB"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "http_app" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    path_pattern {
      values = ["/api/v1", "/api/v1/*"]
    }
  }
}

resource "aws_lb_listener_rule" "http_realtime" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.realtime.arn
  }

  condition {
    path_pattern {
      values = ["/ws", "/ws/*", "/socket.io/*", "/sync/*"]
    }
  }
}

resource "aws_lb_listener" "https" {
  count = local.enable_https ? 1 : 0

  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.api_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "PILO dev ALB"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "https_app" {
  count = local.enable_https ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    path_pattern {
      values = ["/api/v1", "/api/v1/*"]
    }
  }
}

resource "aws_lb_listener_rule" "https_realtime" {
  count = local.enable_https ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.realtime.arn
  }

  condition {
    path_pattern {
      values = ["/ws", "/ws/*", "/socket.io/*", "/sync/*"]
    }
  }
}
