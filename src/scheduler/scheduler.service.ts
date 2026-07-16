import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as cron from 'node-cron';
import { ScraperService } from '../scraper/scraper.service';
import { SupabaseService } from '../database/supabase.service';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);

  private isJobRunning = false;
  private cronTask: cron.ScheduledTask | null = null;
  private currentCronExpression: string | null = null;
  private currentIsActive: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly scraperService: ScraperService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async onModuleInit() {
    this.logger.log(
      'Initializing dynamic cron scheduler for Asia/Baku timezone...',
    );

    await this.checkAndReloadSchedule();

    this.pollInterval = setInterval(() => {
      this.checkAndReloadSchedule();
    }, 60 * 1000);
  }

  private async checkAndReloadSchedule() {
    try {
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase
        .from('scraping_schedules')
        .select('cron_expression, is_active')
        .eq('id', 1)
        .single();

      if (error) {
        this.logger.error(
          'Failed to fetch scraping schedule from Supabase:',
          error,
        );
        return;
      }

      if (!data) {
        this.logger.warn('No schedule found in scraping_schedules with id=1.');
        return;
      }

      const newCronExpression = data.cron_expression;
      const newIsActive = data.is_active;

      // const newCronExpression = '50 0 * * *';
      // const newIsActive = true;

      if (
        this.currentCronExpression !== newCronExpression ||
        this.currentIsActive !== newIsActive
      ) {
        this.logger.log(
          `Schedule change detected: active=${newIsActive}, cron='${newCronExpression}'. Reloading cron...`,
        );

        this.currentCronExpression = newCronExpression;
        this.currentIsActive = newIsActive;
        this.restartCron();
      }
    } catch (err) {
      this.logger.error('Unexpected error while checking schedule:', err);
    }
  }

  private restartCron() {
    // Stop the existing cron task if it is running
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    // If active and a valid expression exists, schedule a new task
    if (this.currentIsActive && this.currentCronExpression) {
      const isValid = cron.validate(this.currentCronExpression);

      if (!isValid) {
        this.logger.error(
          `Invalid cron expression received: ${this.currentCronExpression}`,
        );
        return;
      }

      this.cronTask = cron.schedule(
        this.currentCronExpression,
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

      this.logger.log(
        `Cron scheduler started successfully with expression: '${this.currentCronExpression}'`,
      );
    } else {
      this.logger.log(
        'Cron scheduler is currently INACTIVE based on database settings.',
      );
    }
  }

  onModuleDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.cronTask) {
      this.cronTask.stop();
      this.logger.log('Cron scheduler stopped on destroy.');
    }
  }
}
