import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as cron from 'node-cron';
import { ScraperService } from '../scraper/scraper.service';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private isJobRunning = false;
  private cronTask: cron.ScheduledTask | null = null;

  constructor(private readonly scraperService: ScraperService) {}

  onModuleInit() {
    this.logger.log('Initializing cron scheduler for Asia/Baku timezone...');

    // Run exactly twice a day: at 15:00 and 21:00.
    this.cronTask = cron.schedule(
      '0 15,21 * * *',
      async () => {
        this.logger.log('Cron triggered: Starting scheduled scraping job.');

        if (this.isJobRunning) {
          this.logger.warn(
            'Previous scraping job is still running. Skipping this run to prevent overlap.',
          );
          return;
        }

        this.isJobRunning = true;
        try {
          // Trigger the master loop that will iterate over all active sources
          await this.scraperService.websiteScrapingMain();
          this.logger.log('Scheduled scraping job completed successfully.');
        } catch (error) {
          this.logger.error(
            'Error occurred during scheduled scraping job',
            error,
          );
        } finally {
          this.isJobRunning = false;
        }
      },
      {
        timezone: 'Asia/Baku',
      },
    );
  }

  onModuleDestroy() {
    if (this.cronTask) {
      this.cronTask.stop();
      this.logger.log('Cron scheduler stopped.');
    }
  }
}
