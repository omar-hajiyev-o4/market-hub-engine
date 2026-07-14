import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): any {
    return 'Market Hub Engine API Çalışır! ⚡';
  }
}
