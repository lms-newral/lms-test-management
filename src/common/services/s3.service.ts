import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { StorageClass } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

/**
 * The slice of the main backend's S3Service the question bank uses: the
 * Word-import upload slot, reading that file back, and writing images extracted
 * from it. Same env names and bucket as the main backend, so an object written
 * by either service resolves to the same URL.
 *
 * Copied rather than shared: the main backend's version is ~870 lines serving
 * courses, video and landing pages, none of which belong in this service.
 */

const ACE_UNSIGNABLE_HEADERS = [
  'x-amz-content-sha256',
  'x-amz-checksum-crc32',
  'x-amz-sdk-checksum-algorithm',
  'x-amz-checksum-mode',
];

const ACE_UNHOISTABLE_HEADERS = [
  'x-amz-content-sha256',
  'x-amz-checksum-crc32',
  'x-amz-sdk-checksum-algorithm',
  'x-amz-checksum-mode',
  'content-md5',
  'x-amz-storage-class',
];

const ACE_SIGNABLE_HEADERS = ['content-md5', 'x-amz-storage-class'];

export interface PresignedUrlResponse {
  uploadUrl: string;
  fileUrl: string;
  key: string;
  expiresIn: number;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly endpoint?: string;
  private readonly forcePathStyle: boolean;
  private readonly cdnDomain: string;
  private readonly storageClass?: StorageClass;

  constructor(private readonly configService: ConfigService) {
    const get = (key: string) => this.configService.get<string>(key);

    const region = get('ACE_S3_REGION') || get('AWS_REGION') || 'us-east-1';
    this.bucketName =
      get('ACE_S3_BUCKET') || get('AWS_S3_BUCKET') || 'lms-assets-bucket';
    this.endpoint =
      get('ACE_S3_ENDPOINT') ||
      get('S3_ENDPOINT') ||
      get('AWS_ENDPOINT_URL_S3') ||
      undefined;
    this.forcePathStyle = this.getBooleanConfig(
      'ACE_S3_FORCE_PATH_STYLE',
      this.getBooleanConfig('S3_FORCE_PATH_STYLE', Boolean(this.endpoint)),
    );
    this.cdnDomain =
      get('ACE_CDN_DOMAIN') ||
      get('AWS_CDN_DOMAIN') ||
      `https://${this.bucketName}.s3.${region}.amazonaws.com`;
    const storageClass =
      get('ACE_S3_STORAGE_CLASS') ||
      get('S3_STORAGE_CLASS') ||
      (this.endpoint ? 'STANDARD' : undefined);
    this.storageClass = storageClass as StorageClass | undefined;

    this.s3Client = new S3Client({
      region,
      endpoint: this.endpoint,
      forcePathStyle: this.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId:
          get('ACE_S3_ACCESS_KEY_ID') || get('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey:
          get('ACE_S3_SECRET_ACCESS_KEY') || get('AWS_SECRET_ACCESS_KEY') || '',
      },
    });

    this.logger.log(
      `S3Service initialized - Bucket: ${this.bucketName}, Endpoint: ${this.endpoint || 'aws-default'}`,
    );
  }

  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<string> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return `${this.cdnDomain}/${key}`;
  }

  /**
   * Upload slot for a question-bank Word import. Keys under
   * question-bank/imports/{jobId}, never quizzes/{quizId}, so an import's source
   * document cannot be mistaken for a quiz asset.
   */
  async getQuestionImportUploadUrl(
    tenantId: string,
    jobId: string,
    fileName: string,
  ): Promise<PresignedUrlResponse> {
    // The filename becomes an S3 key, so strip anything that would nest a
    // directory or escape it.
    const safeName =
      fileName.replace(/[^\w.\-]+/g, '_').slice(-120) || 'import.docx';
    const key = `tenants/${tenantId}/question-bank/imports/${jobId}/source/${Date.now()}-${safeName}`;
    const response = await this.generatePresignedUploadUrl(
      key,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      600,
    );

    return {
      uploadUrl: response.uploadUrl,
      fileUrl: response.fileUrl,
      key: response.key,
      expiresIn: response.expiresIn,
    };
  }

  /**
   * Upload slot for a test's planner PDF. Keyed under tests/{testId}/planner so
   * setTestPlanner can refuse any key that was not issued for that test.
   */
  async getTestPlannerUploadUrl(
    tenantId: string,
    testId: string,
    fileName: string,
  ): Promise<PresignedUrlResponse> {
    const safeName =
      fileName.replace(/[^\w.\-]+/g, '_').slice(-120) || 'planner.pdf';
    const key = `tenants/${tenantId}/tests/${testId}/planner/${Date.now()}-${safeName}`;
    return this.generatePresignedUploadUrl(key, 'application/pdf', 600);
  }

  /**
   * Upload slot for a test series cover image. Keyed under test-series/{id}/cover
   * so setTestSeriesCover can refuse any key that was not issued for that series.
   */
  async getTestSeriesCoverUploadUrl(
    tenantId: string,
    seriesId: string,
    fileName: string,
    contentType: string,
  ): Promise<PresignedUrlResponse> {
    const safeName =
      fileName.replace(/[^\w.\-]+/g, '_').slice(-120) || 'cover';
    const key = `tenants/${tenantId}/test-series/${seriesId}/cover/${Date.now()}-${safeName}`;
    return this.generatePresignedUploadUrl(key, contentType, 600);
  }

  async downloadFile(key: string): Promise<Buffer> {
    const response = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
    );
    const stream = response.Body as Readable;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600 * 2,
  ): Promise<PresignedUrlResponse> {
    try {
      const uploadUrl = this.endpoint
        ? await this.generateAceRecommendedPresignedPutUrl(key, expiresIn)
        : await this.generateAwsPresignedPutUrl(key, contentType, expiresIn);

      return {
        uploadUrl,
        fileUrl: this.getPublicObjectUrl(key),
        key,
        expiresIn,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned URL for key ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  private async generateAwsPresignedPutUrl(
    key: string,
    contentType: string,
    expiresIn: number,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  private async generateAceRecommendedPresignedPutUrl(
    key: string,
    expiresIn: number,
    contentMD5?: string,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      StorageClass: this.storageClass,
      ContentMD5: contentMD5,
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn,
      signableHeaders: new Set(ACE_SIGNABLE_HEADERS),
      unsignableHeaders: new Set(ACE_UNSIGNABLE_HEADERS),
      unhoistableHeaders: new Set(ACE_UNHOISTABLE_HEADERS),
    });
  }

  /**
   * A time-limited read link. The bucket is private, so stored images and PDFs
   * must be shown through one of these, never the plain object URL.
   */
  async getPresignedGetUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    // Same ACE header handling as uploads; plain AWS signs normally.
    return getSignedUrl(
      this.s3Client,
      command,
      this.endpoint
        ? {
            expiresIn,
            signableHeaders: new Set(ACE_SIGNABLE_HEADERS),
            unsignableHeaders: new Set(ACE_UNSIGNABLE_HEADERS),
            unhoistableHeaders: new Set(ACE_UNHOISTABLE_HEADERS),
          }
        : { expiresIn },
    );
  }

  getPublicObjectUrl(key: string): string {
    const encodedKey = this.encodeS3KeyPath(key.replace(/^\/+/, ''));

    if (this.endpoint) {
      const endpoint = new URL(this.endpoint);
      return this.forcePathStyle
        ? `${endpoint.protocol}//${endpoint.host}/${this.bucketName}/${encodedKey}`
        : `${endpoint.protocol}//${this.bucketName}.${endpoint.host}/${encodedKey}`;
    }

    return `${this.cdnDomain.replace(/\/$/, '')}/${encodedKey}`;
  }

  private encodeS3KeyPath(key: string): string {
    return key
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
  }

  private getBooleanConfig(key: string, fallback: boolean): boolean {
    const value = this.configService.get<string>(key);
    if (value === undefined || value === '') return fallback;
    return ['1', 'true', 'yes', 'y'].includes(value.toLowerCase());
  }
}
