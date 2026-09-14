import { Injectable, Logger } from '@nestjs/common';

/**
 * Converts legacy Word images (WMF/EMF) to PNG via the LibreOffice sidecar.
 *
 * WHY A SIDECAR. The API image is `node:20-alpine` and pandoc rides along as a
 * static binary. LibreOffice is ~500 MB and Alpine's packaging of it is not
 * something to depend on in production, so it runs as its own Debian container
 * on the internal network and is reached over HTTP. See docker-compose.yml.
 *
 * WHY THE GUARDS. This takes files a user uploaded. An `.emf` that makes
 * `soffice` hang would otherwise wedge an import worker indefinitely, and a
 * decompression bomb would fill the disk. So: a timeout per file, a cap on both
 * input and output, and no egress from the sidecar itself.
 *
 * WHY FAILURE IS A WARNING. If the sidecar is down, the correct outcome is a
 * flagged image on an otherwise finished import -- not a failed job. Losing a
 * 400-question import because one legacy diagram could not be converted would
 * be a much worse trade than a reviewer seeing "this figure needs replacing".
 * `quiz.service.ts` currently just drops these images and sets alt text, so the
 * author never learns the figure existed at all; that is the gap this closes.
 */

export interface ConversionResult {
  ok: boolean;
  png?: Buffer;
  /** Set when ok is false. Surfaced to the reviewer, never thrown. */
  reason?: string;
}

/** 20 MB in, 20 MB out. A question diagram is orders of magnitude smaller. */
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

@Injectable()
export class LibreOfficeClient {
  private readonly logger = new Logger(LibreOfficeClient.name);
  private readonly baseUrl = process.env.LIBREOFFICE_URL?.replace(/\/+$/, '');

  /** False when no sidecar is configured, so callers can skip it quietly. */
  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  async toPng(input: Buffer, filename: string): Promise<ConversionResult> {
    if (!this.baseUrl) {
      return {
        ok: false,
        reason:
          'No image converter is configured, so this legacy image was kept as ' +
          'it is and will not display.',
      };
    }

    if (input.byteLength > MAX_INPUT_BYTES) {
      return {
        ok: false,
        reason: `"${filename}" is larger than 20 MB and was not converted.`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(input)], {
          type: 'application/octet-stream',
        }),
        filename,
      );

      const res = await fetch(`${this.baseUrl}/convert/png`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        return {
          ok: false,
          reason: `The image converter refused "${filename}" (${res.status}).`,
        };
      }

      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_OUTPUT_BYTES) {
        return {
          ok: false,
          reason: `Converting "${filename}" produced more than 20 MB.`,
        };
      }

      const png = Buffer.from(await res.arrayBuffer());
      if (png.byteLength === 0) {
        return { ok: false, reason: `Converting "${filename}" produced nothing.` };
      }
      if (png.byteLength > MAX_OUTPUT_BYTES) {
        return {
          ok: false,
          reason: `Converting "${filename}" produced more than 20 MB.`,
        };
      }

      return { ok: true, png };
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      const reason = aborted
        ? `Converting "${filename}" timed out after ${TIMEOUT_MS / 1000}s.`
        : `The image converter is unreachable, so "${filename}" was kept as it is.`;
      // Deliberately a log, not a throw. The import continues.
      this.logger.warn(`${reason} (${e instanceof Error ? e.message : e})`);
      return { ok: false, reason };
    } finally {
      clearTimeout(timer);
    }
  }
}
