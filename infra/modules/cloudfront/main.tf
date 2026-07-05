locals {
  use_custom_certificate = var.acm_certificate_arn != "" && length(var.aliases) > 0
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.name_prefix}-frontend-oac"
  description                       = "OAC for PILO frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "frontend_static_route_rewrite" {
  name    = "${var.name_prefix}-frontend-static-route-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite static export routes to route index files"
  publish = true
  code    = <<-EOT
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === "" || uri === "/") {
    request.uri = "/index.html";
    return request;
  }

  if (uri.indexOf("/_next/") === 0) {
    return request;
  }

  var lastSlashIndex = uri.lastIndexOf("/");
  var lastSegment = uri.substring(lastSlashIndex + 1);
  if (lastSegment.indexOf(".") !== -1) {
    return request;
  }

  if (uri.charAt(uri.length - 1) === "/") {
    request.uri = uri + "index.html";
  } else {
    request.uri = uri + "/index.html";
  }

  return request;
}
EOT
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.name_prefix} frontend"
  default_root_object = "index.html"
  aliases             = var.aliases
  price_class         = "PriceClass_100"

  origin {
    domain_name              = var.frontend_bucket_domain_name
    origin_id                = "frontend-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id       = "frontend-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.frontend_static_route_rewrite.arn
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.use_custom_certificate ? false : true
    acm_certificate_arn            = local.use_custom_certificate ? var.acm_certificate_arn : null
    ssl_support_method             = local.use_custom_certificate ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_certificate ? "TLSv1.2_2021" : null
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = var.frontend_bucket_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipalReadOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${var.frontend_bucket_arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}
