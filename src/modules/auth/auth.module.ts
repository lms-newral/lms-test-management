import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionService } from './session.service';

/**
 * Global so GqlAuthGuard can be resolved wherever a resolver applies it -- the
 * ported question-bank resolvers use @UseGuards(GqlAuthGuard) from inside their
 * own modules.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [SessionService],
  exports: [SessionService],
})
export class AuthModule {}
