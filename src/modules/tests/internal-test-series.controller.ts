import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { notDeleted } from 'src/prisma/soft-delete';
import { Public } from 'src/common/decorators/public.decorator';
import { payableOf, seriesVisible } from './test-series.logic';

interface EnrollBody {
  tenantId?: unknown;
  userId?: unknown;
  userName?: unknown;
  userEmail?: unknown;
  amountPaid?: unknown;
  purchaseId?: unknown;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Server-to-server endpoints for the main backend, which owns payments: it
 * reads a series' price before creating an order, and enrolls the student after
 * the payment succeeds. Guarded by the shared INTERNAL_API_TOKEN, never by a
 * user session, so browsers cannot reach them.
 */
@Public()
@Controller('internal/test-series')
export class InternalTestSeriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private authorize(token: string | undefined) {
    const expected = this.config.get<string>('INTERNAL_API_TOKEN');
    const given = Buffer.from(token ?? '');
    const wanted = Buffer.from(expected ?? '');
    if (!expected || given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new UnauthorizedException('Invalid internal token');
    }
  }

  @Get(':id')
  async getSeries(
    @Headers('x-internal-token') token: string | undefined,
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId?: string,
  ) {
    this.authorize(token);
    const s = await this.prisma.testSeries.findFirst({
      where: { id, tenantId, ...notDeleted() },
      include: userId ? { enrollments: { where: { userId }, select: { id: true } } } : undefined,
    });
    if (!s) throw new NotFoundException('Test series not found');
    const price = s.price === null ? null : Number(s.price);
    const discountedPrice = s.discountedPrice === null ? null : Number(s.discountedPrice);
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      visible: seriesVisible(s, new Date()),
      isPaid: s.isPaid,
      price,
      discountedPrice,
      payable: payableOf({ isPaid: s.isPaid, price, discountedPrice }),
      endAt: s.endAt,
      isEnrolled: 'enrollments' in s ? (s.enrollments as unknown[]).length > 0 : false,
    };
  }

  /** Idempotent: a webhook and a client verify can both arrive for one payment. */
  @Post(':id/enroll')
  async enroll(
    @Headers('x-internal-token') token: string | undefined,
    @Param('id') id: string,
    @Body() body: EnrollBody,
  ) {
    this.authorize(token);
    const tenantId = text(body.tenantId);
    const userId = text(body.userId);
    if (!tenantId || !userId) throw new BadRequestException('tenantId and userId are required');
    const amountPaid = typeof body.amountPaid === 'number' && body.amountPaid >= 0 ? body.amountPaid : null;

    const s = await this.prisma.testSeries.findFirst({ where: { id, tenantId, ...notDeleted() }, select: { id: true } });
    if (!s) throw new NotFoundException('Test series not found');

    const enrollment = await this.prisma.testSeriesEnrollment.upsert({
      where: { seriesId_userId: { seriesId: id, userId } },
      create: {
        tenantId,
        seriesId: id,
        userId,
        userName: text(body.userName),
        userEmail: text(body.userEmail),
        source: 'PAID',
        amountPaid,
        purchaseId: text(body.purchaseId),
      },
      // Already in (free or added by an admin) and now paid: record the payment.
      update: { source: 'PAID', amountPaid, purchaseId: text(body.purchaseId) },
    });
    return { enrollmentId: enrollment.id };
  }
}
