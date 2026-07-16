import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpException, HttpStatus, Injectable, OnModuleDestroy } from "@nestjs/common";

interface DriveStorageConfig {
  bucket: string;
  region: string;
}

interface DriveStorageClient {
  send(command: HeadObjectCommand): Promise<{ ContentLength?: number }>;
  destroy?: () => void;
}

interface CreateUploadUrlInput {
  objectKey: string;
  mimeType: string;
  expiresInSeconds: number;
}

interface CreateDownloadUrlInput {
  objectKey: string;
  fileName: string;
  mimeType: string;
  expiresInSeconds: number;
}

@Injectable()
export class DriveStorageService implements OnModuleDestroy {
  private s3Client: S3Client | null = null;
  private s3ClientConfigKey: string | null = null;

  async createUploadUrl(input: CreateUploadUrlInput): Promise<string> {
    const config = this.getConfig();
    const client = this.getS3Client(config);

    try {
      return await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.objectKey,
          ContentType: input.mimeType
        }),
        {
          expiresIn: input.expiresInSeconds
        }
      );
    } catch {
      throw this.badGateway("Drive upload URL could not be created");
    }
  }

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<string> {
    const config = this.getConfig();
    const client = this.getS3Client(config);

    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: input.objectKey,
          ResponseContentDisposition: this.contentDisposition(input.fileName),
          ResponseContentType: input.mimeType
        }),
        {
          expiresIn: input.expiresInSeconds
        }
      );
    } catch {
      throw this.badGateway("Drive download URL could not be created");
    }
  }

  async createPreviewUrl(input: CreateDownloadUrlInput): Promise<string> {
    const config = this.getConfig();
    const client = this.getS3Client(config);

    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: input.objectKey,
          ResponseContentDisposition: this.inlineContentDisposition(input.fileName),
          ResponseContentType: input.mimeType
        }),
        {
          expiresIn: input.expiresInSeconds
        }
      );
    } catch {
      throw this.badGateway("Drive preview URL could not be created");
    }
  }

  async getObjectSizeBytes(objectKey: string): Promise<number | null> {
    const config = this.getConfig();
    const client = this.getS3Client(config);

    try {
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: config.bucket,
          Key: objectKey
        })
      );

      return typeof result.ContentLength === "number" ? result.ContentLength : null;
    } catch (error) {
      if (this.isMissingObjectError(error)) {
        return null;
      }

      throw this.badGateway("Drive uploaded object could not be checked");
    }
  }

  onModuleDestroy(): void {
    this.s3Client?.destroy();
    this.s3Client = null;
    this.s3ClientConfigKey = null;
  }

  protected createS3Client(config: DriveStorageConfig): S3Client {
    return new S3Client({
      region: config.region
    });
  }

  private getS3Client(config: DriveStorageConfig): S3Client {
    const configKey = `${config.region}\n${config.bucket}`;

    if (this.s3Client === null || this.s3ClientConfigKey !== configKey) {
      this.s3Client?.destroy();
      this.s3Client = this.createS3Client(config);
      this.s3ClientConfigKey = configKey;
    }

    return this.s3Client;
  }

  private getConfig(): DriveStorageConfig {
    return {
      bucket: this.requireConfig(process.env.S3_UPLOADS_BUCKET),
      region: this.requireConfig(process.env.AWS_REGION)
    };
  }

  private requireConfig(value: string | undefined): string {
    if (typeof value !== "string" || !value.trim()) {
      throw this.badGateway("Drive storage is not configured");
    }

    return value.trim();
  }

  private contentDisposition(fileName: string): string {
    return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  }

  private inlineContentDisposition(fileName: string): string {
    return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  }

  private isMissingObjectError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const candidate = error as {
      name?: unknown;
      $metadata?: { httpStatusCode?: unknown };
    };

    return (
      candidate.name === "NotFound" ||
      candidate.name === "NoSuchKey" ||
      candidate.$metadata?.httpStatusCode === 404
    );
  }

  private badGateway(message: string): HttpException {
    return new HttpException(
      {
        success: false,
        error: {
          code: "BAD_GATEWAY",
          message
        }
      },
      HttpStatus.BAD_GATEWAY
    );
  }
}
